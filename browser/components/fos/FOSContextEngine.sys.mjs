/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pillar C: the Context Engine, wired to a window.
 *
 * The store is the durable half and this is the live half — what watches
 * browsing happen and decides what is worth writing down. Three rules shape it:
 *
 * RECORDING NEVER BLOCKS BROWSING. Every write goes through `#enqueue`, which
 * chains onto a single promise. Nothing on the navigation path awaits it. A
 * database that is slow, locked or broken must cost a page load nothing, so a
 * failed write is logged and dropped — losing a row is a far smaller harm than
 * stalling the browser to keep one.
 *
 * THE TREE IS RECONCILED, NOT MIRRORED BY EVENTS. `FOSTrailSession` announces
 * that its tree changed, not what changed, so this walks the tree and writes
 * whatever it has not seen. That is deliberately dull: an event stream would
 * have to be right about grafts, branches and restores separately, and every
 * one of those is a chance to drift from the tree the user can see. Walking
 * cannot drift.
 *
 * A CONTEXT IS SEEDED BY PROVENANCE, NOT BY A CLOCK. Each trail gets a context
 * and its nodes and queries join that one. The search-log literature is why:
 * around 75% of queries are issued while the user is multi-tasking, and
 * timeout-based boundary detection tops out near 70% precision on task
 * boundaries, so a context inferred from a recency window would be wrong most
 * of the time it mattered. Which trail a page is on is a fact the user stated
 * by opening a tab, and `context <mark>` lets them say otherwise outright.
 * Embedding-based merging of contexts across trails is the next step and rests
 * on this floor rather than replacing it — `context_member.source` is what
 * keeps the two distinguishable afterwards.
 */

import {
  deriveOutcome,
  extractEntities,
  normaliseIntent,
} from "./FOSContextSignals.sys.mjs";
import { buildContextPack } from "./FOSContextPack.sys.mjs";
import { FOSContextStore } from "./FOSContextStore.sys.mjs";

/** One database per profile, shared by every window. */
let storePromise = null;

/** Windows to their engine. */
const byWindow = new WeakMap();

/**
 * A `MarkRegistry` key for a context, namespaced like the trail session's.
 *
 * @param {number} id A context's database id.
 * @returns {string}
 */
export function contextKey(id) {
  return `context:${id}`;
}

/**
 * @param {?string} key
 * @returns {?number} The context id, or null if the key is not a context's.
 */
export function contextIdFromKey(key) {
  const match = /^context:(\d+)$/.exec(key ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * One window's recorder, and the owner of pillar C's three verbs.
 */
export class FOSContextEngine {
  /**
   * @param {Window} window A browser window.
   * @returns {FOSContextEngine}
   */
  static forWindow(window) {
    let engine = byWindow.get(window);
    if (!engine) {
      engine = new FOSContextEngine(window);
      byWindow.set(window, engine);
    }
    return engine;
  }

  /**
   * The profile's store, opened once.
   *
   * @param {object} [options]
   * @param {string} [options.path] Overrides the profile path, for tests.
   * @returns {Promise<FOSContextStore>}
   */
  static store({ path } = {}) {
    if (!storePromise) {
      storePromise = FOSContextStore.open({ path });
    }
    return storePromise;
  }

  /** Drop the shared store, so a test can open a fresh one. */
  static async resetStore() {
    const opened = storePromise;
    storePromise = null;
    if (opened) {
      await (await opened).close();
    }
  }

  #window;
  #session = null;
  #marks = null;
  #store = null;
  #unsubscribe = [];

  /** In-memory trail id → database trail id, for this session. */
  #trailIds = new Map();
  /** In-memory node id → database node id, for this session. */
  #nodeIds = new Map();
  /** Database trail id → its provenance context id. */
  #contextByTrail = new Map();

  /** The open visit, if any: `{nodeId, visitId, since, accrued}`. */
  #visit = null;
  /** Whether this window currently has the user's attention. */
  #focused = true;
  /** The context the user is working in, overriding provenance when set. */
  #activeContextId = null;
  /** A query recorded but not yet attached to the node it opened. */
  #pendingQuery = null;
  /** Serialises writes so they land in the order they happened. */
  #queue = Promise.resolve();

  constructor(window) {
    this.#window = window;
  }

  /** The context the user is working in, or null before anything is recorded. */
  get activeContextId() {
    return this.#activeContextId;
  }

  /** The queue, so a test can await everything outstanding. */
  get settled() {
    return this.#queue;
  }

  /**
   * Start recording.
   *
   * @param {object} options
   * @param {object} options.session An `FOSTrailSession`.
   * @param {object} [options.store] An open store; defaults to the profile's.
   * @param {?object} [options.marks] A `MarkRegistry`.
   * @returns {Promise<FOSContextEngine>}
   */
  async attach({ session, store = null, marks = null }) {
    this.#session = session;
    this.#marks = marks ?? session.marks;
    this.#store = store ?? (await FOSContextEngine.store());

    this.#unsubscribe.push(session.subscribe(() => this.#reconcile()));
    this.#unsubscribe.push(
      session.onDeparture(nodeId => this.#closeVisit(nodeId))
    );

    // Foreground time only, so the clock stops when the window loses focus.
    // Without this a page left open behind another window reads as an hour of
    // rapt attention, which would make `read` mean nothing at all.
    this.#window.addEventListener("activate", this);
    this.#window.addEventListener("deactivate", this);

    this.#reconcile();
    return this;
  }

  detach() {
    for (const off of this.#unsubscribe.splice(0)) {
      off();
    }
    this.#window.removeEventListener("activate", this);
    this.#window.removeEventListener("deactivate", this);
    this.#closeVisit(null);
  }

  handleEvent(event) {
    if (event.type === "activate") {
      this.#focused = true;
      if (this.#visit) {
        this.#visit.since = Date.now();
      }
    } else if (event.type === "deactivate") {
      this.#focused = false;
      if (this.#visit) {
        this.#visit.accrued += Date.now() - this.#visit.since;
      }
    }
  }

  // ---- recording ----------------------------------------------------------

  /**
   * Chain a write. Never awaited by anything on the navigation path.
   *
   * @param {Function} task An async function taking the store.
   * @returns {Promise} The queue, for tests.
   */
  #enqueue(task) {
    this.#queue = this.#queue
      // Before `attach` has resolved there is nothing to write to. Skipping is
      // right rather than queueing: window init does not wait on the disk, so
      // the alternative is a queue that fires against a null store and fills
      // the console with failures for the ordinary startup case.
      .then(() => (this.#store ? task(this.#store) : undefined))
      .catch(e => {
        // Dropping a row costs a little fidelity in the record. Rethrowing
        // would poison the queue and cost every row after it, so this is where
        // it stops.
        console.error("FOSContextEngine: write failed", e);
      });
    return this.#queue;
  }

  /**
   * Write down anything in the in-memory tree the database has not seen.
   *
   * Nodes are walked in creation order so a parent is always written before its
   * child; a node whose parent is somehow still unmapped is skipped and picked
   * up by the next reconciliation rather than being written with a null parent,
   * which would quietly flatten the tree that is the whole point of pillar B.
   */
  #reconcile() {
    const session = this.#session;
    if (!session) {
      return;
    }
    const trails = session.store.trails();
    const nodes = session.store.nodes();

    this.#enqueue(async store => {
      for (const trail of trails) {
        let trailId = this.#trailIds.get(trail.id);
        if (trailId === undefined) {
          trailId = await store.addTrail({ name: trail.name });
          this.#trailIds.set(trail.id, trailId);
          // One context per trail, seeded by provenance. Labelled from the
          // trail when the trail has a name and left null when it does not —
          // an invented label would be indistinguishable from one the user
          // chose, and `name` is how a context gets a real one.
          const contextId = await store.addContext({ label: trail.name });
          this.#contextByTrail.set(trailId, contextId);
          if (this.#activeContextId === null) {
            this.#activeContextId = contextId;
          }
        } else if (trail.name) {
          await store.nameTrail(trailId, trail.name);
          const contextId = this.#contextByTrail.get(trailId);
          if (contextId) {
            await store.labelContext(contextId, trail.name);
          }
        }
      }

      for (const node of nodes) {
        const trailId = this.#trailIds.get(node.trail_id);
        if (trailId === undefined) {
          continue;
        }
        let nodeId = this.#nodeIds.get(node.id);
        if (nodeId === undefined) {
          const parentId =
            node.parent_id === null ? null : this.#nodeIds.get(node.parent_id);
          if (parentId === undefined) {
            continue;
          }
          nodeId = await store.addNode({
            trailId,
            parentId,
            url: node.url,
            title: node.title,
          });
          this.#nodeIds.set(node.id, nodeId);

          const contextId = this.#contextByTrail.get(trailId);
          if (contextId) {
            await store.addMember(contextId, { nodeId, source: "provenance" });
          }
          if (node.title) {
            await store.recordEntities(extractEntities(node.title), { nodeId });
          }
          // The query that opened this page has been waiting for it to exist.
          if (this.#pendingQuery !== null) {
            await store.attachQueryToNode(this.#pendingQuery, nodeId);
            this.#pendingQuery = null;
          }
        } else {
          await store.updateNode(nodeId, {
            title: node.title ?? undefined,
            scrollX: node.scroll_x ?? undefined,
            scrollY: node.scroll_y ?? undefined,
            dismissedAt: node.dismissed_at ?? undefined,
          });
        }
      }
    });

    this.#openVisit(session.currentNodeId);
    this.#syncContextMarks();
  }

  /**
   * Record a query as it is issued.
   *
   * @param {string} raw Exactly what was typed or spoken.
   * @param {object} [options]
   * @param {string} [options.inputMode] `keyboard` | `voice`.
   */
  recordQuery(raw, { inputMode = "keyboard" } = {}) {
    const text = String(raw ?? "").trim();
    if (!text) {
      return;
    }
    const sourceNodeId =
      this.#nodeIds.get(this.#session?.currentNodeId) ?? null;
    const contextId = this.#activeContextId;

    this.#enqueue(async store => {
      const queryId = await store.recordQuery({
        raw: text,
        normalisedIntent: normaliseIntent(text),
        sourceNodeId,
        inputMode,
      });
      // Held so the next node created can claim it. A query and the page it
      // opens are recorded by two different mechanisms — one from the command
      // bar, one from the progress listener — and this is the seam between
      // them.
      this.#pendingQuery = queryId;
      await store.recordEntities(extractEntities(text), { queryId });
      if (contextId !== null) {
        await store.addMember(contextId, { queryId, source: "provenance" });
      }
    });
  }

  /**
   * Start timing a visit, closing any that was open.
   *
   * @param {?number} memNodeId An in-memory node id.
   */
  #openVisit(memNodeId) {
    if (memNodeId === null || this.#visit?.memNodeId === memNodeId) {
      return;
    }
    this.#closeVisit(this.#visit?.memNodeId ?? null);
    const started = Date.now();
    this.#visit = { memNodeId, visitId: null, since: started, accrued: 0 };
    const visit = this.#visit;
    this.#enqueue(async store => {
      const nodeId = this.#nodeIds.get(memNodeId);
      if (nodeId === undefined) {
        return;
      }
      visit.visitId = await store.startVisit(nodeId, started);
    });
  }

  /**
   * Close the open visit and derive its outcome.
   *
   * @param {?number} memNodeId The node being left, for the caller's clarity.
   */
  #closeVisit(memNodeId) {
    const visit = this.#visit;
    if (!visit || (memNodeId !== null && visit.memNodeId !== memNodeId)) {
      return;
    }
    this.#visit = null;
    const dwellMs =
      visit.accrued + (this.#focused ? Date.now() - visit.since : 0);
    this.#enqueue(async store => {
      if (visit.visitId === null) {
        return;
      }
      await store.endVisit(visit.visitId, {
        dwellMs,
        outcome: deriveOutcome({ dwellMs }),
      });
    });
  }

  // ---- marks --------------------------------------------------------------

  /**
   * Give live contexts marks, from whatever letters are left.
   *
   * Contexts register *after* the trail session has marked the active trail, so
   * they take from the remainder rather than from the pages the user is working
   * with — a Field holding forty cards must not be able to leave the page under
   * the cursor unaddressable in order to name a topic. `assign` returns null
   * when all 26 are held, and a context without a letter is simply not
   * reachable by `context <mark>` yet. That is the honest cost of the budget,
   * and the fix is search by name, which `GRAMMAR.md` §2 already specifies as
   * the path past 26.
   */
  #syncContextMarks() {
    if (!this.#marks) {
      return;
    }
    for (const [trailId, contextId] of this.#contextByTrail) {
      const trail = [...this.#trailIds.entries()].find(
        ([, id]) => id === trailId
      );
      const memTrail = trail ? this.#session?.store.getTrail(trail[0]) : null;
      this.#marks.assign(contextKey(contextId), {
        label: memTrail?.name ?? "",
        type: "context",
      });
    }
  }

  // ---- reads --------------------------------------------------------------

  /**
   * Everything the engine holds on the active context.
   *
   * @returns {Promise<?object>} A `contextContents` shape, or null.
   */
  async contents() {
    await this.#queue;
    if (this.#activeContextId === null) {
      return null;
    }
    return this.#store.contextContents(this.#activeContextId);
  }

  /**
   * A one-line answer to "what do you have on this?".
   *
   * @returns {Promise<string>}
   */
  async summarise() {
    const contents = await this.contents();
    if (!contents) {
      return "No context yet — browse or search and one will start.";
    }
    const { context, queries, pages, entities } = contents;
    const label = context.label?.trim() || "an unnamed context";
    const read = pages.filter(
      page => page.outcome === "read" || page.outcome === "saved"
    ).length;
    const topics = entities
      .filter(entity => entity.weight >= 0.5)
      .slice(0, 5)
      .map(entity => entity.name);
    const parts = [
      `${label}: ${plural(queries.length, "question")}, ` +
        `${plural(pages.length, "page")}, ${read} read`,
    ];
    if (topics.length) {
      parts.push(`about ${topics.join(", ")}`);
    }
    return parts.join(" — ");
  }

  /**
   * Every context the user could switch to, with its mark.
   *
   * @returns {Promise<object[]>}
   */
  async contexts() {
    await this.#queue;
    const rows = await this.#store.contexts();
    return rows.map(row => ({
      ...row,
      mark: this.#marks?.markOf(contextKey(row.id)) ?? null,
    }));
  }

  // ---- verbs --------------------------------------------------------------

  /**
   * Bind pillar C's verbs.
   *
   * @param {object} bar An `FOSCommandBar`.
   * @returns {FOSContextEngine} This engine.
   */
  wire(bar) {
    this.#unsubscribe.push(bar.actions.onQuery(text => this.recordQuery(text)));

    // `context <mark>` is the one place the user overrides provenance. Once
    // set it stays set, because a context you switched into deliberately must
    // not be taken away by the next navigation — that would make the verb a
    // suggestion rather than a statement.
    bar.actions.register("context", cmd => {
      const id = contextIdFromKey(this.#marks?.objectAt(cmd.target));
      if (id === null) {
        return false;
      }
      this.#activeContextId = id;
      this.#enqueue(store => store.touchContext(id));
      return id;
    });

    bar.actions.register("what", () => this.report(() => this.summarise()));

    bar.actions.register("pack", () =>
      this.report(async () => {
        const contents = await this.contents();
        if (!contents) {
          return "Nothing to export yet.";
        }
        const markdown = buildContextPack(contents, { now: Date.now() });
        copyToClipboard(markdown, this.#window);
        const label = contents.context.label?.trim() || "context";
        return `Context pack for "${label}" copied — ${markdown.split("\n").length} lines, ready to paste.`;
      })
    );

    return this;
  }

  /**
   * Run a read and show its one-line answer in the command bar.
   *
   * Both `what` and `pack` answer in a sentence rather than opening a surface,
   * because both are questions asked in passing. The sidebar that `SCHEMA.md`
   * calls the second surface is a place to *stay*, and it is a separate piece
   * of work; this is deliberately the smaller thing, not a stand-in for it.
   *
   * @param {Function} produce An async function returning a message.
   * @returns {Promise<string>} The message, for tests.
   */
  async report(produce) {
    let message;
    try {
      message = await produce();
    } catch (e) {
      console.error(e);
      message = "The context engine could not answer that.";
    }
    this.#window.FOSCommandBar?.notify?.(message);
    return message;
  }
}

/**
 * @param {number} n
 * @param {string} noun Singular.
 * @returns {string}
 */
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * @param {string} text
 * @param {Window} window
 */
function copyToClipboard(text, window) {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(
    Ci.nsITransferable
  );
  transferable.init(window.docShell?.QueryInterface(Ci.nsILoadContext) ?? null);
  const string = Cc["@mozilla.org/supports-string;1"].createInstance(
    Ci.nsISupportsString
  );
  string.data = text;
  transferable.addDataFlavor("text/plain");
  transferable.setTransferData("text/plain", string);
  Services.clipboard.setData(
    transferable,
    null,
    Ci.nsIClipboard.kGlobalClipboard
  );
}
