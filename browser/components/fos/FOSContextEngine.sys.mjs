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
 *
 * Embedding-based merging across trails rests on that floor rather than
 * replacing it: it is *offered* and never applied, and an accepted offer is
 * recorded as `context.merged_into` rather than as membership. The plan had
 * been to write the merged rows with `context_member.source = 'manual'`, and
 * it does not work — `contextsForTrails` filters on `provenance` by
 * construction, so membership written under any other source changes what a
 * context contains without changing which context a trail is in. See
 * `FOSContextMerge.sys.mjs` for the threshold and `002-merged-contexts.sql`
 * for why the merge is a fact about contexts instead.
 */

import {
  deriveOutcome,
  extractEntities,
  normaliseIntent,
} from "./FOSContextSignals.sys.mjs";
import { bestMerge } from "./FOSContextMerge.sys.mjs";
import { buildContextPack } from "./FOSContextPack.sys.mjs";
import { summariseContents } from "./FOSContextSidebarView.sys.mjs";
import { FOSContextStore } from "./FOSContextStore.sys.mjs";
import {
  cosine,
  relatedCandidates,
  suggestionsFor,
} from "./FOSSuggest.sys.mjs";
import { resolveMarkToken } from "./FOSMarks.sys.mjs";
import { nodeKey, nodeIdFromKey } from "./FOSTrailSession.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  // The floor tier only. Loaded on the first keystroke into the command bar
  // rather than with the engine, which is imported on the navigation path and
  // has no business pulling Places in behind it.
  frecencyMatches: "resource:///modules/FOSPlacesFloor.sys.mjs",
  // The `related` tier only, and it may never load: the weights are an
  // optional download, so this is deferred for the same reason the floor is —
  // a navigation must not pull an ML engine in behind it.
  FOSEmbeddings: "resource:///modules/FOSEmbeddings.sys.mjs",
});

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

  /**
   * Whether the shared store has already been opened in this process.
   *
   * `store()` opens on demand, so asking for it is not a way to find out. A
   * caller that must not *cause* the database to exist — clearing history on a
   * profile that has never used the Context Engine — needs to know first.
   *
   * @returns {boolean}
   */
  static get storeIsOpen() {
    return storePromise !== null;
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
  #bar = null;
  #session = null;
  #marks = null;
  #store = null;
  #unsubscribe = [];

  /** In-memory trail id → database trail id, for this session. */
  #trailIds = new Map();
  /** In-memory node id → database node id, for this session. */
  #nodeIds = new Map();
  /** Pillar A's surface, when this window has one. */
  #field = null;
  /** Database trail id → its provenance context id. */
  #contextByTrail = new Map();

  /** The open visit, if any: `{nodeId, visitId, since, accrued}`. */
  #visit = null;
  /** Whether this window currently has the user's attention. */
  #focused = true;
  /**
   * A context the user switched into by hand, overriding provenance until they
   * switch again. Null means "follow the trail I am on".
   */
  #pinnedContextId = null;
  /**
   * A surface that can *show* what `what` reports, if one is attached.
   *
   * `GRAMMAR.md` §4 has always described `what` as answering "spoken or shown",
   * and the two halves are one verb rather than two: the sentence is what a
   * hands-free path would say, the panel is what a screen shows. The engine
   * owns the verb because the verb is pillar C's; the surface is optional
   * because a window without one must still be able to answer.
   */
  #surface = null;

  /** A query recorded but not yet attached to the node it opened. */
  #pendingQuery = null;
  /**
   * In-memory node id → the values last written for it.
   *
   * Reconciliation walks the whole tree on every change, so without this every
   * navigation rewrote every node it had ever seen. That was merely wasteful
   * while the columns were three integers and a title; it stopped being so
   * once the session-store blob joined them, since that is the largest thing
   * the engine writes and the one least likely to have changed.
   */
  #written = new Map();
  /** Database trail id → the name last written for it. */
  #trailNames = new Map();
  /** Database trail ids already written as archived, so `done` writes once. */
  #archivedTrails = new Set();
  /** Serialises writes so they land in the order they happened. */
  #queue = Promise.resolve();

  constructor(window) {
    this.#window = window;
  }

  /**
   * The context the user is working in, or null before anything is recorded.
   *
   * Derived rather than stored, and that is the point. Held as a field it was
   * set once when the first trail appeared and then never moved, so opening a
   * second tab left every query and every page filed under the first tab's
   * topic — the exact failure the provenance rule exists to avoid, arrived at
   * from the other direction. Reading it from the trail the user is on now
   * cannot drift, for the same reason the tree is reconciled rather than
   * mirrored.
   *
   * `context <mark>` pins a context and outranks this: a context switched into
   * deliberately must not be taken away by the next navigation, or the verb
   * would be a suggestion rather than a statement.
   */
  get activeContextId() {
    if (this.#pinnedContextId !== null) {
      return this.#pinnedContextId;
    }
    const trailId = this.#trailIds.get(this.#session?.activeTrailId);
    return trailId === undefined
      ? null
      : (this.#contextByTrail.get(trailId) ?? null);
  }

  /** The queue, so a test can await everything outstanding. */
  get settled() {
    return this.#queue;
  }

  /**
   * Attach the surface `what` should open.
   *
   * Called by the surface rather than by the engine, so that the engine never
   * has to import one — this module is loaded by the recorder on the
   * navigation path, and a display it may never show has no business being
   * pulled in behind it.
   *
   * @param {?object} surface Anything with an async `open()`.
   */
  setSurface(surface) {
    this.#surface = surface;
  }

  /**
   * Start recording.
   *
   * @param {object} options
   * @param {object} options.session An `FOSTrailSession`.
   * @param {object} [options.store] An open store; defaults to the profile's.
   * @param {?object} [options.marks] A `MarkRegistry`.
   * @param {?object} [options.field] An `FOSField`, whose placements are
   *   restored on attach and persisted as the user makes them.
   * @returns {Promise<FOSContextEngine>}
   */
  async attach({ session, store = null, marks = null, field = null }) {
    this.#session = session;
    this.#marks = marks ?? session.marks;
    this.#store = store ?? (await FOSContextEngine.store());
    this.#field = field;

    // Before subscribing, so the first reconciliation already knows which rows
    // exist and writes none of them a second time.
    await this.#hydrate();

    this.#unsubscribe.push(session.subscribe(() => this.#reconcile()));
    if (field) {
      this.#unsubscribe.push(
        field.onPlacement(placement => this.#recordPlacement(placement))
      );
    }
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
   * Put the previous session's trails back, once per launch.
   *
   * The direction is the mirror of `#reconcile`, and the id maps are what make
   * the two agree: seeding them with what was just read is what tells the next
   * reconciliation that these rows already exist. Without that it would see a
   * tree full of nodes it had never written and write every one of them again,
   * so restoring a session would double it.
   *
   * Every failure here is survivable and none of them may stop a window
   * opening, so a database that cannot be read costs the user their previous
   * trails and nothing else.
   */
  async #hydrate() {
    const session = this.#session;
    // A window with a tree of its own is not a window that just launched, and
    // the store may be absent entirely if `attach` was given none.
    if (!session || !this.#store || session.store.trails().length) {
      return;
    }
    // Restoration happens once per database, into whichever window asks first.
    // Each window keeps its own tree — a tab is a trail and a tab belongs to a
    // window — so restoring into every window would put one trail on two
    // Fields, with two windows reconciling their own copy of it onto the same
    // rows. One window gets the past back; the rest open as they always did.
    if (!this.#store.claimRestoration()) {
      return;
    }

    let records;
    let ids;
    try {
      records = await this.#store.restorable();
      if (!records.trails.length) {
        return;
      }
      // `hydrate` validates before it writes, so a set it refuses leaves the
      // tree empty rather than half restored, and this window opens as though
      // there were nothing to come back to.
      ids = session.hydrate(records);
    } catch (e) {
      console.error("FOSContextEngine: cannot restore the previous session", e);
      return;
    }
    for (const [databaseId, memoryId] of ids.trails) {
      this.#trailIds.set(memoryId, databaseId);
    }
    for (const [databaseId, memoryId] of ids.nodes) {
      this.#nodeIds.set(memoryId, databaseId);
    }
    for (const trail of records.trails) {
      this.#trailNames.set(trail.id, trail.name ?? null);
    }
    for (const memoryId of ids.nodes.values()) {
      const node = session.store.getNode(memoryId);
      if (node) {
        this.#written.set(memoryId, signatureOf(node));
      }
    }

    await this.#restorePlacements(ids.nodes);

    try {
      const contexts = await this.#store.contextsForTrails([
        ...ids.trails.keys(),
      ]);
      for (const [trailId, contextId] of contexts) {
        this.#contextByTrail.set(trailId, contextId);
      }
    } catch (e) {
      // A restored trail whose context did not come back gets a fresh one from
      // the next reconciliation, so this costs the topic's history and not the
      // trail.
      console.error("FOSContextEngine: cannot read restored contexts", e);
    }

    this.#syncContextMarks();
  }

  /**
   * Give the Field back the positions the user chose, last session.
   *
   * `FIELD.md` §4 promises a pinned card holds its position "not to make room,
   * not to rebalance a region, not on restart"; §9 lists it as an acceptance
   * property. This is the restart half. Everything it needs existed before
   * this run — the table, the store method, the model's pinned flag — and
   * nothing joined them, so a restored session re-seeded every card and any
   * arrangement the user had made was silently gone.
   *
   * Only user placements are stored, so this is a small read: one row per card
   * anybody ever dragged, not one per page.
   *
   * @param {Map<number, number>} nodes Database id → in-memory id.
   */
  async #restorePlacements(nodes) {
    if (!this.#field || !nodes.size) {
      return;
    }
    try {
      const saved = await this.#store.placements([...nodes.keys()]);
      if (!saved.size) {
        return;
      }
      const byMemoryId = new Map();
      for (const [databaseId, at] of saved) {
        const memoryId = nodes.get(databaseId);
        if (memoryId !== undefined) {
          byMemoryId.set(memoryId, at);
        }
      }
      this.#field.restorePlacements(byMemoryId);
    } catch (e) {
      // The Field is already usable — every card is seeded where provenance
      // puts it — so this degrades to the arrangement a first-time user gets
      // rather than to a broken surface.
      console.error("FOSContextEngine: cannot restore placements", e);
    }
  }

  /**
   * Recompute trail → context for every trail this session knows about.
   *
   * The same read `#hydrate` does, factored out because accepting a merge has
   * to redo it: the map is derived state, and the rule this component keeps
   * arriving at is that derived state is recomputed rather than patched. See
   * `activeContextId`, which is a getter for the same reason.
   */
  async #rebuildContextMap() {
    const trailIds = [...this.#trailIds.values()];
    if (!trailIds.length) {
      return;
    }
    const contexts = await this.#store.contextsForTrails(trailIds);
    for (const [trailId, contextId] of contexts) {
      this.#contextByTrail.set(trailId, contextId);
    }
    this.#syncContextMarks();
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
          this.#trailNames.set(trailId, trail.name ?? null);
        } else {
          // A restored trail can arrive without a context — one recorded before
          // contexts existed, or one whose members were all moved elsewhere by
          // `context <mark>`. Reconciliation is where a missing row is noticed,
          // so it is where this is healed rather than at restore time.
          if (!this.#contextByTrail.has(trailId)) {
            const contextId = await store.addContext({ label: trail.name });
            this.#contextByTrail.set(trailId, contextId);
          }
          if (trail.name && this.#trailNames.get(trailId) !== trail.name) {
            await store.nameTrail(trailId, trail.name);
            this.#trailNames.set(trailId, trail.name);
            const contextId = this.#contextByTrail.get(trailId);
            if (contextId) {
              await store.labelContext(contextId, trail.name);
            }
          }
        }
        // `done` reaches the database the same way `name` does, because it is
        // the same kind of fact: something the user said about a trail, mirrored
        // on the next reconciliation rather than written on the command's own
        // path. The set is what keeps it to one write — reconciliation runs on
        // every session change, and an archived trail stays archived forever.
        if (trail.archived_at !== null && !this.#archivedTrails.has(trailId)) {
          await store.archiveTrail(trailId, trail.archived_at);
          this.#archivedTrails.add(trailId);
        } else if (
          trail.archived_at === null &&
          this.#archivedTrails.has(trailId)
        ) {
          // Re-entry resumed it. The set has to give the id back or the trail
          // could never be finished a second time, which is the ordinary shape
          // of using this: close a thread, get pulled back into it, close it
          // again.
          await store.resumeTrail(trailId);
          this.#archivedTrails.delete(trailId);
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
          this.#written.set(node.id, signatureOf(node));

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
            // And it joins the context this page just joined. The membership
            // written when the query was issued used whatever context was
            // active *then*, which in the commonest case of all — a search
            // typed into a fresh tab — is not this one and is usually none at
            // all, because the context does not exist until the page arrives.
            // That lost exactly the questions worth keeping: the one that
            // starts an enquiry is the one its pack most needs to state.
            //
            // The page a question opened is a fact; the context that happened
            // to be active while it was being typed is a guess. Both are kept
            // rather than one replacing the other — a question asked while
            // working on one topic that opens another really was asked in
            // both, and the unique index makes the overlap free.
            if (contextId) {
              await store.addMember(contextId, {
                queryId: this.#pendingQuery,
                source: "provenance",
              });
            }
            this.#pendingQuery = null;
          }
        } else {
          const signature = signatureOf(node);
          if (!sameSignature(this.#written.get(node.id), signature)) {
            await store.updateNode(nodeId, {
              title: node.title ?? undefined,
              scrollX: node.scroll_x ?? undefined,
              scrollY: node.scroll_y ?? undefined,
              // The blob is what makes re-entry lossless across a restart:
              // without it a restored node can be reopened at its URL and its
              // scroll offset, and the form the user had half filled in is
              // gone.
              formState: node.form_state ?? undefined,
              dismissedAt: node.dismissed_at ?? undefined,
            });
            this.#written.set(node.id, signature);
          }
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
    const contextId = this.activeContextId;

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
   * Give *named* contexts marks.
   *
   * The budget is 26 letters shared by every pillar, so anything registering a
   * new kind of object has to say what it gives up. Contexts give up nothing,
   * because they only claim a letter once the user has named the trail behind
   * one — and that is not a dodge, it is the honest reading of what the verb
   * does. `context <mark>` switches the context you are working in; an unnamed
   * context is precisely "the trail you are already on", so there is nothing to
   * switch to and the letter would buy the user nothing.
   *
   * Naming is already what promotes an object to first-class in this design, so
   * a context earns its letter at exactly the moment it becomes somewhere you
   * might come back to.
   *
   * This was not a taste call. With unnamed contexts claiming letters, a
   * context took the mnemonic letter a page wanted and `browser_trailrail.js`
   * caught a node on example.com addressed as `t` — a page you cannot guess the
   * letter for is a page you have to hunt for, which is the whole value of a
   * mnemonic mark gone. Pages are where addressing actually happens; they get
   * the alphabet.
   */
  #syncContextMarks() {
    if (!this.#marks) {
      return;
    }
    for (const [memTrailId, trailId] of this.#trailIds) {
      const contextId = this.#contextByTrail.get(trailId);
      const name = this.#session?.store.getTrail(memTrailId)?.name;
      if (contextId === undefined || !name) {
        continue;
      }
      this.#marks.assign(contextKey(contextId), {
        label: name,
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
    const contextId = this.activeContextId;
    if (contextId === null) {
      return null;
    }
    return this.#store.contextContents(contextId);
  }

  /**
   * The context worth offering to merge with the active one, or null.
   *
   * Computed when a surface asks, which in practice is when the sidebar opens,
   * and never on the navigation path. That is Horvitz's third principle rather
   * than an implementation convenience: the timing of an offer is part of its
   * cost, and the moment the user is browsing is the moment they are least
   * interested in being asked to do filing. Opening the sidebar is a voluntary
   * glance at exactly this question — the same argument that put the
   * background-arrival signal on a surface the user chooses to look at.
   *
   * Best-effort in the same way the `related` tier is: no weights means no
   * offer, which is the browser working as it does today rather than a broken
   * promise. Nothing here is written, so a failure costs nothing.
   *
   * @returns {Promise<?{contextId: number, label: ?string, score: number}>}
   */
  async mergeOffer() {
    await this.#queue;
    const activeId = this.activeContextId;
    if (activeId === null || !this.#store) {
      return null;
    }

    try {
      // Only contexts the user could still switch to; a merged one is already
      // part of something and must not be offered a second time.
      const family = new Set(await this.#store.contextFamily(activeId));
      const others = (await this.#store.contexts()).filter(
        row => !family.has(row.id)
      );
      if (!others.length) {
        return null;
      }

      const texts = await this.#store.contextQueryTexts([
        ...family,
        ...others.map(row => row.id),
      ]);
      // A context nobody has searched in has nothing to compare. Provenance
      // put its pages there, and pages are not what this threshold was
      // measured over.
      const activeTexts = [...family].flatMap(id => texts.get(id) ?? []);
      if (!activeTexts.length) {
        return null;
      }

      const withQueries = others.filter(row => texts.get(row.id)?.length);
      if (!withQueries.length) {
        return null;
      }

      // One embed call for everything, because the model is a lookup table and
      // the cost is in the round trip rather than in the rows.
      const flat = [
        ...activeTexts,
        ...withQueries.flatMap(row => texts.get(row.id)),
      ];
      const vectors = await lazy.FOSEmbeddings.embed(flat);
      if (!vectors) {
        return null;
      }

      let at = activeTexts.length;
      const activeVectors = vectors.slice(0, at);
      const candidates = withQueries.map(row => {
        const count = texts.get(row.id).length;
        const slice = vectors.slice(at, at + count);
        at += count;
        return { id: row.id, label: row.label, vectors: slice };
      });

      return bestMerge({
        activeId,
        activeVectors,
        candidates,
        declined: await this.#store.declinedMerges(),
      });
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  /**
   * Accept an offer: the active context and `contextId` are one enquiry.
   *
   * Awaited rather than enqueued, unlike everything else this class writes.
   * The recording rules exist because a navigation must never wait on a
   * database, and this is not a navigation — it is a thing the user just asked
   * for and is watching for the result of, so it is allowed to take its time
   * and it is allowed to fail visibly.
   *
   * @param {number} contextId
   * @returns {Promise<boolean>} False if there was nothing to do.
   */
  async acceptMerge(contextId) {
    await this.#queue;
    const activeId = this.activeContextId;
    if (activeId === null || !this.#store) {
      return false;
    }
    const merged = await this.#store.mergeContexts(activeId, contextId);
    if (!merged) {
      return false;
    }
    // The trail→context map was built before the merge and still names the
    // context that lost. Rebuilding it is what makes `activeContextId` answer
    // the merged root from the next read onwards, and it is the same walk
    // `#hydrate` does — derived state, recomputed rather than patched.
    await this.#rebuildContextMap();
    return true;
  }

  /**
   * Turn an offer down, permanently.
   *
   * @param {number} contextId
   */
  async declineMerge(contextId) {
    await this.#queue;
    const activeId = this.activeContextId;
    if (activeId !== null && this.#store) {
      await this.#store.declineMerge(activeId, contextId);
    }
  }

  /**
   * A one-line answer to "what do you have on this?".
   *
   * The sentence itself is built in `FOSContextSidebarView` because the sidebar
   * shows the same one as its heading, and a claim stated in two places is a
   * claim that will eventually be stated two ways.
   *
   * @returns {Promise<string>}
   */
  async summarise() {
    return summariseContents(await this.contents());
  }

  /**
   * Every node in the database for a URL, across every trail.
   *
   * @param {string} url
   * @returns {Promise<object[]>} Rows, or empty before `attach`.
   */
  async crossings(url) {
    await this.#queue;
    return this.#store ? this.#store.crossings(url) : [];
  }

  /**
   * Every question asked while looking at a URL, across every trail.
   *
   * @param {string} url
   * @returns {Promise<object[]>} Rows, or empty before `attach`.
   */
  async questionsFrom(url) {
    await this.#queue;
    return this.#store ? this.#store.questionsFrom(url) : [];
  }

  /** The database trail id for the trail the user is on, or null. */
  get activeTrailRowId() {
    return this.#trailIds.get(this.#session?.activeTrailId) ?? null;
  }

  /** The active context's mark, if it has earned one. */
  get activeContextMark() {
    const id = this.activeContextId;
    return id === null ? null : (this.#marks?.markOf(contextKey(id)) ?? null);
  }

  /**
   * In-memory node id → the database row id it was written as.
   *
   * @param {?number} nodeId
   * @returns {?number} Null when the node has not been written yet.
   */
  nodeRowId(nodeId) {
    return nodeId === null ? null : (this.#nodeIds.get(nodeId) ?? null);
  }

  /**
   * Keep a position the user chose.
   *
   * The Field is a per-window model over an in-memory tree and knows nothing
   * about rows, so this is the translation: pillar A says which node, pillar C
   * knows what that node was written as.
   *
   * A node with no row yet is dropped rather than queued. The reconciliation
   * that writes it is already running, and the position is on the card — so
   * the next placement of the same card carries it. Queueing would mean
   * holding a coordinate that a later drag has already made wrong.
   *
   * @param {{nodeId: number, x: number, y: number}} placement
   */
  async #recordPlacement({ nodeId, x, y }) {
    const rowId = this.nodeRowId(nodeId);
    if (rowId === null || !this.#store) {
      return;
    }
    try {
      await this.#store.placeCard(rowId, {
        x,
        y,
        pinned: true,
        // The timestamp is the record that a human did this, and the store's
        // COALESCE keeps the first one. It is what separates a position from
        // a seat the system happened to pick.
        movedByUserAt: Date.now(),
      });
    } catch (e) {
      // A lost placement costs the arrangement on the next start and nothing
      // in this session: the card is where the user put it either way.
      console.error("FOSContextEngine: cannot record a placement", e);
    }
  }

  /**
   * Database row id → the in-memory node it stands for.
   *
   * The reverse of `nodeRowId`, and it is a scan rather than a second map
   * because a surface asks this once per click while the forward direction is
   * asked on every reconciliation of every node. Null is a real answer and not
   * a failure: a row from a trail this session did not restore has no node in
   * the tree, and a caller has to say something honest about that.
   *
   * @param {?number} rowId
   * @returns {?number}
   */
  nodeIdForRow(rowId) {
    if (rowId === null || rowId === undefined) {
      return null;
    }
    for (const [memId, written] of this.#nodeIds) {
      if (written === rowId) {
        return memId;
      }
    }
    return null;
  }

  // ---- what the command bar offers ----------------------------------------

  /**
   * Rank what is on offer for a query.
   *
   * The ordering itself is in `FOSSuggest`, which is pure. This is the half
   * that cannot be: it reads the five sources, and four of the five come from
   * the **store** rather than from this window's tree. That is the whole
   * design decision restated as code — a bar that could only offer what this
   * session has already loaded would work exactly when the user did not need
   * it, and around 60% of complex information-gathering tasks continue across
   * sessions.
   *
   * @param {string} query What the user has typed.
   * @param {object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<object[]>} Rows for the bar, or empty.
   */
  async suggest(query, { limit } = {}) {
    const text = String(query ?? "").trim();
    if (!text || !this.#store) {
      return [];
    }

    const contextId = this.activeContextId;
    const trailId = this.activeTrailRowId;

    // The floor is read in parallel with the tiers above it and from a
    // different database, so a slow Places must not hold up the four tiers
    // this component owns; `Promise.all` waits for both, and the floor's own
    // failure path returns empty rather than throwing.
    const [contents, trail, crossings, history] = await Promise.all([
      contextId === null ? null : this.contents(),
      trailId === null ? [] : this.#store.trailPages(trailId),
      contextId === null
        ? []
        : this.#store.contextCrossings(contextId, { excludeTrailId: trailId }),
      lazy.frecencyMatches(text, { limit: 20 }).catch(error => {
        console.error(error);
        return [];
      }),
    ]);

    const sources = {
      marked: this.#markedFor(text),
      context: this.#withMarks(contents?.pages ?? []),
      trail: this.#withMarks(trail),
      crossings: this.#withMarks(crossings),
      history,
    };

    return suggestionsFor(
      text,
      { ...sources, related: await this.#related(text, sources) },
      { limit }
    );
  }

  /**
   * The `related` tier: pages that answer the query by meaning after the other
   * tiers have taken everything that answers it by spelling.
   *
   * Candidates are drawn from the tiers this component owns — the context, the
   * trail and its crossings — and **not** from the Places floor. That is a
   * scope this run tried to widen and could not, so it is worth stating rather
   * than leaving to be rediscovered: the floor's rows arrive from
   * `frecencyMatches(text)`, which is itself a lexical query, so a page
   * sharing no word with what was typed is not in that array to be recovered.
   * Reaching it would mean embedding *all* of Places on every keystroke, and
   * at 1.27ms a page that is a vector store with persistence and staleness
   * rules — the thing Firefox's own semantic history search built. It is a
   * real feature and it is not this one.
   *
   * What this tier does cover is every page the fork itself knows about, which
   * is where its own users' enquiries live.
   *
   * Everything here is best-effort. A machine without the weights gets no
   * engine, `embed` returns null, and the tier is absent — which is a shorter
   * list, not a failure. See `FOSEmbeddings` for why that differs from the
   * voice path.
   *
   * @param {string} text What the user has typed.
   * @param {object} sources The tiers already gathered.
   * @returns {Promise<object[]>} Candidates carrying a `similarity`.
   */
  async #related(text, sources) {
    const seen = new Set();
    const candidates = [];
    for (const tier of ["context", "trail", "crossings"]) {
      for (const page of relatedCandidates(text, sources[tier])) {
        const url = String(page.url ?? "");
        if (url && !seen.has(url)) {
          seen.add(url);
          candidates.push(page);
        }
      }
    }
    if (!candidates.length) {
      return [];
    }

    try {
      const vectors = await lazy.FOSEmbeddings.embed([
        text,
        ...candidates.map(page => page.title),
      ]);
      if (!vectors) {
        return [];
      }
      const [query, ...titles] = vectors;
      return candidates.map((page, index) => ({
        ...page,
        similarity: cosine(query, titles[index]),
      }));
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  /**
   * The page a whole line addresses, when the line is nothing but a mark.
   *
   * Both forms resolve: `g` as typed and `gust` as spoken, through the one
   * `resolveMarkToken` every other surface uses. So the letter a user learned
   * from the rail works in the bar without a verb in front of it, and the word
   * a hands-free path would say works in the typed bar too — which is what
   * `GRAMMAR.md` §5 means by one path rather than a mode.
   *
   * The row is *offered*, never triggered: Enter on an untouched line still
   * searches, because `g` is also a perfectly good thing to search for.
   *
   * @param {string} text The whole trimmed input.
   * @returns {object[]} One page, or none.
   */
  #markedFor(text) {
    if (/\s/.test(text)) {
      return [];
    }
    const letter = resolveMarkToken(text);
    if (!letter) {
      return [];
    }
    const memId = nodeIdFromKey(this.#marks?.objectAt(letter));
    const node = memId === null ? null : this.#session?.store.getNode(memId);
    if (!node?.url) {
      return [];
    }
    return [
      {
        id: this.nodeRowId(memId),
        url: node.url,
        title: node.title,
        mark: letter,
      },
    ];
  }

  /**
   * Attach each row's mark, where the page it names is live in this window.
   *
   * A page that already carries a letter should show it here: the bar is the
   * only surface that teaches the vocabulary, and a mark learned while going
   * to a page is a mark learned at the moment it is useful.
   *
   * @param {object[]} rows Store rows carrying a node id.
   * @returns {object[]} The same rows, with `mark` set where there is one.
   */
  #withMarks(rows) {
    return rows.map(row => {
      const memId = this.nodeIdForRow(row.id);
      return {
        ...row,
        mark:
          memId === null ? null : (this.#marks?.markOf(nodeKey(memId)) ?? null),
      };
    });
  }

  /**
   * Go to a page the bar offered.
   *
   * Two cases, and the difference matters. A page still on a live trail is
   * **re-entered**, which is pillar B's restore and brings back scroll
   * position and form state; a page that is only a row in the database — an
   * older trail this session did not restore, or a Places row that was never
   * on a trail at all — is loaded fresh. The bar does not know which it is
   * holding, and must not: deciding what a page *is* belongs to the pillar
   * that records them.
   *
   * @param {object} row A row from `suggest`.
   * @returns {boolean} Whether a live node was re-entered.
   */
  activate(row) {
    // A mark is an address, so a row carrying one resolves through it rather
    // than through the database. This also covers the page the engine has not
    // written yet: recording is fire-and-forget, so the node under the cursor
    // may legitimately have no row id for another moment.
    const marked = row?.mark
      ? nodeIdFromKey(this.#marks?.objectAt(row.mark))
      : null;
    const memId = marked ?? this.nodeIdForRow(row?.nodeId ?? null);
    if (memId !== null && this.#session) {
      this.#session.enter(memId);
      return true;
    }
    if (row?.url) {
      // Loaded as the URL it is, not put back through query resolution: the
      // user picked a page off a list rather than typing a line, and recording
      // this as a query would write a URL into the query log as though it had
      // been one.
      this.#bar?.actions.openURL(row.url);
    }
    return false;
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
    // Held, rather than reached for through the window at report time. There is
    // no `window.FOSCommandBar` — the window's lazy getters live on a module
    // `lazy` object, not on the global — so a lookup there is quietly undefined
    // and every answer is computed and then dropped on the floor.
    this.#bar = bar;
    this.#unsubscribe.push(bar.actions.onQuery(text => this.recordQuery(text)));

    // The third of pillar C's three surfaces. It binds no verb — `context
    // <mark>` already promises to "re-rank suggestions" and this is what makes
    // that promise true — so the alphabet and the action table are both
    // untouched by it.
    bar.setSuggestions({
      suggest: query => this.suggest(query),
      activate: row => this.activate(row),
    });

    // `context <mark>` is the one place the user overrides provenance. Once
    // set it stays set, because a context you switched into deliberately must
    // not be taken away by the next navigation — that would make the verb a
    // suggestion rather than a statement.
    bar.actions.register("context", cmd => {
      // Bare `context` releases the pin and goes back to following the trail
      // you are on. Without it a single deliberate switch outlives the enquiry
      // that motivated it: every later tab, on every later topic, is still
      // ranked and summarised against the context that was pinned, because
      // nothing but another pin could ever displace it.
      if (cmd.target === null) {
        this.#pinnedContextId = null;
        return this.activeContextId;
      }
      const id = contextIdFromKey(this.#marks?.objectAt(cmd.target));
      if (id === null) {
        return false;
      }
      this.#pinnedContextId = id;
      this.#enqueue(store => store.touchContext(id));
      return id;
    });

    bar.actions.register("what", () =>
      this.report(async () => {
        const sentence = await this.summarise();
        // Opened after the sentence is built, so a surface that throws cannot
        // cost the user the answer they asked for.
        await this.#surface?.open();
        return sentence;
      })
    );

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

    // The consent step for the `related` tier, and the only verb in the table
    // that changes what the browser is allowed to fetch rather than where the
    // user is. It lives here rather than in `FOSEmbeddings` because that
    // module is process-wide and has no window to speak into: the engine is
    // shared, but the account of it is owed to the bar the verb was typed in.
    bar.actions.register("model", () => this.#downloadModel());

    return this;
  }

  /**
   * Fetch the model the `related` tier needs, saying what is being fetched.
   *
   * Four outcomes, and each of them is a sentence rather than a silence,
   * because a verb the user reached for deliberately is the one place in this
   * component where nothing-happened is not an acceptable answer. That is the
   * opposite of the tier itself, which is allowed to be quietly absent — see
   * `FOSEmbeddings` for why the two differ.
   *
   * @returns {Promise<boolean>} Whether the tier is on when this returns.
   */
  async #downloadModel() {
    const embeddings = lazy.FOSEmbeddings;
    if (embeddings.downloading) {
      this.#bar?.notify("The search model is already downloading.");
      return false;
    }

    const present = await embeddings.present();
    if (present && embeddings.enabled) {
      this.#bar?.notify(
        "The search model is already here — suggestions rank by meaning."
      );
      return true;
    }

    // Said before the fetch rather than after it, and it names the host: this
    // fork disables update and telemetry so that it never contacts Mozilla
    // behind the user's back, and the honest way to make the one exception is
    // to write down who is being contacted while it happens. `present` above
    // is what keeps this off the screen when nothing is being transferred.
    if (!present) {
      this.#bar?.notify(
        `Downloading the search model — about ${embeddings.weightsMB}MB, ` +
          `once, from ${embeddings.hubHost}. It runs on this machine ` +
          `afterwards and sends nothing back.`
      );
    }

    let shown = -1;
    const engine = await embeddings.download(report => {
      // `report.progress` is a percentage **of the file in flight**, and this
      // model is two files — so it runs 0-100 for the tokeniser and then
      // starts again at 0 for the 30MB table. A bar that goes backwards is
      // worse than no bar. `totalLoaded` is the sum across every callback, so
      // it is the one field that only ever grows.
      const mb = Math.floor(Number(report?.totalLoaded) / 1e6);
      // Only when the whole megabyte changes: the runtime reports every chunk,
      // and this is a live region, so rewriting the same sentence a hundred
      // times a second is a screen reader saying it a hundred times.
      if (!Number.isFinite(mb) || mb <= shown) {
        return;
      }
      shown = mb;
      this.#bar?.notify(
        `Downloading the search model — ${mb}MB of about ` +
          `${embeddings.weightsMB}MB, once.`
      );
    });

    if (!engine) {
      this.#bar?.notify("The search model could not be downloaded.");
      return false;
    }
    this.#bar?.notify(
      "Search model ready — suggestions now rank by meaning as well as " +
        "spelling."
    );
    return true;
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
    this.#bar?.notify(message);
    return message;
  }
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

/**
 * The mutable half of a node — everything an update would write.
 *
 * @param {object} node An in-memory `trail_node`.
 * @returns {object} A comparable snapshot.
 */
function signatureOf(node) {
  return {
    title: node.title ?? null,
    scrollX: node.scroll_x ?? null,
    scrollY: node.scroll_y ?? null,
    formState: node.form_state ?? null,
    dismissedAt: node.dismissed_at ?? null,
  };
}

/**
 * @param {?object} a A previous signature, or undefined for never written.
 * @param {object} b The current signature.
 * @returns {boolean} Whether an update would be a no-op.
 */
function sameSignature(a, b) {
  return (
    !!a &&
    a.title === b.title &&
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.formState === b.formState &&
    a.dismissedAt === b.dismissedAt
  );
}
