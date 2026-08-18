/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pillar B bound to a real window: capture, re-entry, marks and verbs.
 *
 * `FOSTrailTree.sys.mjs` is the model and knows no Gecko API; this is the half
 * that can only exist against a running browser. It does four things:
 *
 *   1. **Captures** every top-level navigation as a child node, so the tree is
 *      built by browsing rather than by asking the user to curate.
 *   2. **Re-enters** any node, restoring the page with the scroll offset and
 *      half-filled forms it had — which is what makes going back cost nothing
 *      and is the precondition for the Field's dismissal gesture.
 *   3. **Marks** the active trail's nodes so the command bar can address them.
 *   4. **Registers** pillar B's verbs on the dispatcher.
 *
 * WHAT MAKES THIS PILLAR B AND NOT A HISTORY TREE. Nothing here ever removes a
 * node. Session history truncates the forward entries the moment you go back
 * and navigate somewhere else; that is the destruction the phase plan is
 * against, and it is why re-entry does not simply call `gotoIndex`. Re-entering
 * a node and navigating again adds a *sibling*, and the branch that session
 * history would have thrown away is still in the tree and still reachable.
 *
 * VIEW STATE IS SESSION STORE'S, NOT OURS. Scroll offsets and form values are
 * already collected per entry by SessionStore, which is what restores them
 * after a crash, so a node stores the blob SessionStore produced and hands it
 * straight back on re-entry. Nothing is scraped out of content, and no format
 * is invented here — see the note on `#captureNow` for the one real limitation.
 */

import { TrailStore } from "./FOSTrailTree.sys.mjs";
import { labelFor } from "./FOSTrailRailView.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  E10SUtils: "resource://gre/modules/E10SUtils.sys.mjs",
  SessionStore: "resource:///modules/sessionstore/SessionStore.sys.mjs",
  TabStateFlusher: "resource:///modules/sessionstore/TabStateFlusher.sys.mjs",
});

/** One session per chrome window. */
// eslint-disable-next-line jsdoc/require-jsdoc
const byWindow = new WeakMap();

/**
 * Mark registry keys are namespaced by object type.
 *
 * The registry is shared by every pillar and keyed on an opaque id, so a trail
 * node 7 and a Field card 7 would otherwise be the same object and would fight
 * over one letter. Namespacing is the cheapest fix and keeps the registry
 * ignorant of what the pillars store.
 *
 * @param {number} id A trail node id.
 * @returns {string} The registry key.
 */
export function nodeKey(id) {
  return `node:${id}`;
}

/**
 * The node id behind a registry key, or null if the key is another pillar's.
 *
 * @param {?string} key A registry key.
 * @returns {?number} The node id.
 */
export function nodeIdFromKey(key) {
  const match = /^node:(\d+)$/.exec(String(key ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * Whether a location is somewhere the user went, or chrome scaffolding.
 *
 * @param {?nsIURI} uri The new location.
 * @returns {boolean} Whether it deserves a node.
 */
function isCapturable(uri) {
  if (!uri) {
    return false;
  }
  const spec = uri.spec;
  return spec !== "about:blank" && spec !== "about:newtab" && spec !== "";
}

/**
 *
 */
export class FOSTrailSession {
  /**
   * The session for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSTrailSession}
   */
  static forWindow(window) {
    let session = byWindow.get(window);
    if (!session) {
      session = new FOSTrailSession(window);
      byWindow.set(window, session);
    }
    return session;
  }

  /** The captured tree. */
  store = new TrailStore();

  #window;
  #marks = null;
  #listeners = new Set();
  #nodeByBrowser = new WeakMap();
  #trailByBrowser = new WeakMap();
  #markedNodes = new Set();
  #retainers = new Set();
  #departures = new Set();
  #restoring = new WeakMap();
  #recent = [];
  #activeTrailId = null;
  #attached = false;

  constructor(window) {
    this.#window = window;
  }

  /**
   * The trail whose nodes are marked and which the rail renders.
   *
   * Each tab opens its own trail, because a tab is already the user's own
   * statement that this is a separate line of enquiry — inferring trails from
   * navigation timing would guess at something they have already told us.
   */
  get activeTrailId() {
    return this.#activeTrailId;
  }

  /** The window's mark registry, once wired. The rail reads node marks here. */
  get marks() {
    return this.#marks;
  }

  /** The node the active browser is on, or null before the first navigation. */
  get currentNodeId() {
    const browser = this.#window.gBrowser?.selectedBrowser;
    return browser ? (this.#nodeByBrowser.get(browser) ?? null) : null;
  }

  /**
   * The node a given browser is on, or null.
   *
   * The Field reads this to know which of its cards has a live browser behind
   * it right now, which is the set it can capture a fresh snapshot for.
   *
   * @param {?object} browser A browser element.
   * @returns {?number} A node id.
   */
  nodeForBrowser(browser) {
    return browser ? (this.#nodeByBrowser.get(browser) ?? null) : null;
  }

  /**
   * The tab whose browser is on a given trail, or null.
   *
   * A tab opens a trail and stays on it, so this is a lookup rather than a
   * guess. It is null once the tab has been closed, which is a real state and
   * not an error: closing a tab does not end its trail.
   *
   * @param {number} trailId
   * @returns {?object} A tab element.
   */
  tabForTrail(trailId) {
    for (const tab of this.#window.gBrowser?.tabs ?? []) {
      if (this.#trailByBrowser.get(tab.linkedBrowser) === trailId) {
        return tab;
      }
    }
    return null;
  }

  /**
   * Start capturing. Idempotent, so a second window opening is harmless.
   *
   * @param {object} [options]
   * @param {?object} [options.marks] A `MarkRegistry` to address nodes in.
   */
  attach({ marks = null } = {}) {
    if (marks) {
      this.#marks = marks;
    }
    if (this.#attached) {
      return this;
    }
    const { gBrowser } = this.#window;
    if (!gBrowser) {
      throw new Error("FOSTrailSession needs a browser window");
    }
    gBrowser.addTabsProgressListener(this);
    gBrowser.tabContainer.addEventListener("TabAttrModified", this);
    gBrowser.tabContainer.addEventListener("TabClose", this);
    gBrowser.tabContainer.addEventListener("TabSelect", this);
    this.#attached = true;
    return this;
  }

  detach() {
    if (!this.#attached) {
      return;
    }
    const { gBrowser } = this.#window;
    gBrowser.removeTabsProgressListener(this);
    gBrowser.tabContainer.removeEventListener("TabAttrModified", this);
    gBrowser.tabContainer.removeEventListener("TabClose", this);
    gBrowser.tabContainer.removeEventListener("TabSelect", this);
    this.#attached = false;
  }

  /**
   * Be told when a page is about to be left, while its browser still shows it.
   *
   * This is the only instant at which anything can be read off the outgoing
   * page — the same instant, and for the same reason, that the scroll offset is
   * captured. The Field uses it to take a card's thumbnail: a page navigated
   * away from has no browser behind it afterwards, so a snapshot taken any
   * later is a snapshot of the next page.
   *
   * @param {Function} listener Called as `(nodeId, browser)`.
   * @returns {Function} An unsubscribe function.
   */
  onDeparture(listener) {
    this.#departures.add(listener);
    return () => this.#departures.delete(listener);
  }

  /**
   * @param {number} nodeId The node being left.
   * @param {object} browser The browser leaving it.
   */
  #departed(nodeId, browser) {
    for (const listener of this.#departures) {
      try {
        listener(nodeId, browser);
      } catch (e) {
        // A listener that throws must not stop the navigation it is watching.
        console.error(e);
      }
    }
  }

  /**
   * Register a supplier of node ids that must keep their marks.
   *
   * Marks go to the active trail, which is right for the rail and wrong for
   * anything that addresses pages across trails — the Field holds cards in
   * every region, and a card whose page had lost its letter could not be
   * entered. Rather than teach pillar B about pillar A, this lets any surface
   * say which pages it considers in play; the union is what stays marked.
   *
   * @param {Function} supplier Returns an iterable of node ids.
   * @returns {Function} A function that stops retaining.
   */
  retain(supplier) {
    this.#retainers.add(supplier);
    this.#syncMarks();
    return () => this.#retainers.delete(supplier);
  }

  /**
   * Subscribe to tree changes. The rail is the only subscriber today.
   *
   * @param {Function} listener Called with this session on every change.
   * @returns {Function} An unsubscribe function.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---- capture ------------------------------------------------------------

  /**
   * A top-level load has begun, so the outgoing page is still the current one.
   *
   * This is the only moment at which the page being left can have its scroll
   * offset read, which is why capture hangs off the start of the next
   * navigation rather than off the end of the last one.
   *
   * @param {object} browser The browser element.
   * @param {object} webProgress The progress instance.
   * @param {object} request The request.
   * @param {number} stateFlags nsIWebProgressListener state flags.
   */
  onStateChange(browser, webProgress, request, stateFlags) {
    if (!webProgress?.isTopLevel) {
      return;
    }
    if (stateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      // Deliberately not awaited: a progress listener must not hold up the
      // load, and nothing downstream depends on the backfill having landed.
      this.#backfillPrevious(browser).then(
        () => this.#changed(),
        () => {}
      );
      return;
    }
    if (!(stateFlags & Ci.nsIWebProgressListener.STATE_START)) {
      return;
    }
    // A restore is not a departure. The load `enter` just started belongs to
    // the node we are arriving at, so capturing here would overwrite the state
    // we are in the middle of replaying with the outgoing page's.
    if (this.#restoring.has(browser)) {
      return;
    }
    const nodeId = this.#nodeByBrowser.get(browser);
    if (nodeId) {
      this.#captureNow(nodeId, browser);
      this.#departed(nodeId, browser);
    }
  }

  /**
   * A top-level load finished: backfill the page it replaced.
   *
   * Departure is the intuitive moment to capture and it is the wrong one. At
   * the instant the next load starts, the parent process's collected state for
   * the outgoing page is routinely still empty — the content process has not
   * reported it yet — so capturing only there loses the scroll offset of most
   * ordinary forward navigations. Session history is the fix rather than a
   * retry loop: once the new page has settled, the entry *behind* it is
   * present, complete, and carries the scroll offset in its `presState`. So
   * the outgoing page is read from history after the fact instead of from the
   * live collector before the fact.
   *
   * The URL check is what makes this safe. History and our tree diverge the
   * moment a branch is re-entered, so a positional read has to prove it landed
   * on the node it meant to.
   *
   * @param {object} browser The browser element.
   */
  async #backfillPrevious(browser) {
    const nodeId = this.#nodeByBrowser.get(browser);
    const node = nodeId ? this.store.getNode(nodeId) : null;
    const parent = node?.parent_id ? this.store.getNode(node.parent_id) : null;
    if (!parent) {
      return;
    }
    // The collected state lags content by design, so a read taken the instant
    // the load stops routinely returns no entries at all. Here — unlike at
    // departure — waiting is free: the entry being read is the one *behind* the
    // current page and nothing further is going to change it.
    try {
      await lazy.TabStateFlusher.flush(browser);
    } catch (e) {
      return;
    }
    const state = this.#rawTabState(browser);
    const previous = state?.entries?.[(state.index ?? 1) - 2] ?? null;
    if (!previous || previous.url !== parent.url) {
      return;
    }
    this.#writeState(parent.id, previous, state);
  }

  /**
   * A top-level navigation committed: every click or search spawns a child.
   *
   * @param {object} browser The browser element.
   * @param {object} webProgress The progress instance.
   * @param {object} request The request.
   * @param {nsIURI} location The new location.
   * @param {number} flags nsIWebProgressListener location-change flags.
   */
  onLocationChange(browser, webProgress, request, location, flags) {
    if (!webProgress?.isTopLevel || !isCapturable(location)) {
      return;
    }

    // A fragment or a pushState does not create a document, and the node's
    // stored scroll and form state already describe where the user is *within*
    // one page, so a same-document change updates the current node rather than
    // adding one. This is the provisional half of the capture rule: an
    // application that navigates entirely by pushState collapses to a single
    // node, and if that turns out to matter the fix is to compare the path
    // rather than to record every fragment.
    // Re-entry navigates in order to put the page back, and that navigation
    // arrives here looking exactly like a click. Left alone it spawns a child
    // of the node just re-entered — so going back would silently add a node
    // every time, and the tree would grow a duplicate spine that nobody
    // browsed. Found only by running it: the model cannot see this, because
    // the model has no idea a restore is a load.
    const restoring = this.#restoring.get(browser);
    if (restoring) {
      this.#restoring.delete(browser);
      if (restoring.url === location.spec) {
        this.#changed();
        return;
      }
    }

    const sameDocument =
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
    const currentId = this.#nodeByBrowser.get(browser) ?? null;
    if (sameDocument && currentId) {
      const node = this.store.getNode(currentId);
      if (node) {
        node.url = location.spec;
        this.#changed();
      }
      return;
    }

    let trailId = this.#trailByBrowser.get(browser);
    if (!trailId) {
      trailId = this.store.createTrail();
      this.#trailByBrowser.set(browser, trailId);
    }

    const nodeId =
      currentId === null
        ? this.store.addNode({ trailId, url: location.spec })
        : this.store.visit(currentId, { url: location.spec });

    this.#setCurrent(browser, nodeId);
    this.#changed();
  }

  /**
   * @param {Event} event A tab event.
   */
  handleEvent(event) {
    const tab = event.target;
    switch (event.type) {
      case "TabAttrModified": {
        // The title is not known when the location changes, so it is backfilled
        // when the tab's label catches up. Without this every row in the rail
        // would read as a hostname for the life of the session.
        if (!event.detail?.changed?.includes("label")) {
          return;
        }
        const nodeId = this.#nodeByBrowser.get(tab.linkedBrowser);
        const node = nodeId ? this.store.getNode(nodeId) : null;
        if (!node) {
          return;
        }
        // The label has to be proved to belong to this node before it is
        // believed. A tab relabels itself to a placeholder for the *next* page
        // as soon as that load starts, which is before the location change
        // that creates the next node — so taking the label on trust wrote each
        // page's placeholder onto its predecessor and shifted every title in
        // the trail by one. Green tests never saw it; three real pages did.
        if (tab.linkedBrowser.currentURI?.spec !== node.url) {
          return;
        }
        const title = tab.linkedBrowser.contentTitle || tab.label;
        if (title && title !== node.title) {
          node.title = title;
          this.#syncMarks();
          this.#changed();
        }
        break;
      }

      case "TabClose": {
        // A closed tab is not a lost trail. The nodes stay, which is the whole
        // of "tabs are unfinished work": closing the window on something is not
        // a statement that you are finished with it.
        const nodeId = this.#nodeByBrowser.get(tab.linkedBrowser);
        if (nodeId) {
          this.#captureNow(nodeId, tab.linkedBrowser);
        }
        break;
      }

      case "TabSelect": {
        const trailId = this.#trailByBrowser.get(tab.linkedBrowser);
        if (trailId && trailId !== this.#activeTrailId) {
          this.#activeTrailId = trailId;
          this.#syncMarks();
        }
        this.#changed();
        break;
      }
    }
  }

  /**
   * Read the tab's collected state into a node, synchronously.
   *
   * LIMITATION worth stating plainly: this does not flush the content process
   * first, so the scroll offset is whatever content last reported rather than
   * the offset at this instant. Flushing is asynchronous, and by the time the
   * flush resolved the tab would already be showing the next page, so an
   * awaited capture here would faithfully record the wrong document. The
   * deliberate paths — `enter` and `dismiss` — flush first, because there the
   * capture happens before anything has started to move.
   *
   * @param {number} nodeId The node to write into.
   * @param {object} browser The browser to read from.
   */
  #captureNow(nodeId, browser) {
    const state = this.#rawTabState(browser);
    const entry = state?.entries?.[(state.index ?? 1) - 1] ?? null;
    if (entry) {
      this.#writeState(nodeId, entry, state);
    }
  }

  /**
   * Flush content, then capture. Used where we control the timing.
   *
   * @param {number} nodeId The node to write into.
   * @param {object} browser The browser to read from.
   */
  async #captureFlushed(nodeId, browser) {
    try {
      await lazy.TabStateFlusher.flush(browser);
    } catch (e) {
      // The tab can go away mid-flush. The cached state is still worth having.
    }
    this.#captureNow(nodeId, browser);
  }

  /**
   * Store one session-history entry on a node.
   *
   * The blob is SessionStore's own output rather than a shape invented here,
   * which is what lets `enter` hand it straight back — including the
   * serialised triggering principal, which cannot be reconstructed after the
   * fact, and `presState`, which is where the scroll offset actually lives.
   *
   * @param {number} nodeId The node to write into.
   * @param {object} entry A session-history entry.
   * @param {object} state The tab state the entry came from.
   */
  #writeState(nodeId, entry, state) {
    // Scroll is per entry, in `presState`, and is *not* the top-level `scroll`
    // key — that one only appears while the entry is the current one and the
    // live collector has reported it. Reading both is what makes a capture
    // taken from history and a capture taken from the live tab agree.
    const raw = entry.presState?.[0]?.scroll ?? state?.scroll?.scroll ?? "0,0";
    const [x, y] = String(raw)
      .split(",")
      .map(n => Number.parseInt(n, 10) || 0);

    this.store.setViewState(nodeId, {
      scrollX: x,
      scrollY: y,
      formState: JSON.stringify({
        entry,
        scroll: state?.scroll ?? null,
        formdata: state?.formdata ?? null,
      }),
    });
  }

  /**
   * The tab's collected state, parsed, or null.
   *
   * @param {object} browser The browser to read.
   * @returns {?object} The parsed tab state.
   */
  #rawTabState(browser) {
    const tab = this.#window.gBrowser?.getTabForBrowser(browser);
    if (!tab) {
      return null;
    }
    try {
      return JSON.parse(lazy.SessionStore.getTabState(tab));
    } catch (e) {
      // getTabState throws for a tab whose window is not tracked yet, which
      // happens during startup and on a tab being torn down.
      return null;
    }
  }

  // ---- re-entry -----------------------------------------------------------

  /**
   * Re-enter a node: restore its page, its scroll offset and its form values.
   *
   * Deliberately not `nsISHistory.gotoIndex`. Session history is linear and
   * truncates on the next navigation, so restoring through it would destroy
   * exactly the forward branch pillar B exists to keep. Instead the node's
   * stored SessionStore blob is replayed as a one-entry tab state, and the
   * branch stays in the tree where the rail can still show it.
   *
   * @param {number} nodeId The node to enter.
   * @returns {Promise<boolean>} Whether the node was entered.
   */
  async enter(nodeId) {
    const node = this.store.getNode(nodeId);
    if (!node) {
      return false;
    }
    const { gBrowser } = this.#window;
    // Restore into the tab that owns this node's trail, not into whichever tab
    // happens to be in front. Pillar B could not reach this case — node marks
    // only ever cover the active trail — but the Field addresses every card in
    // every region, so `enter` on a card three trails away would otherwise
    // have dragged the current tab onto a trail it was never on, and taken its
    // page with it. A trail with no tab left falls through to the selected
    // one, which is the honest reading of re-entering something you closed.
    const owning = this.tabForTrail(node.trail_id);
    const tab = owning ?? gBrowser.selectedTab;
    if (owning && owning !== gBrowser.selectedTab) {
      gBrowser.selectedTab = owning;
    }
    const browser = tab.linkedBrowser;

    const leaving = this.#nodeByBrowser.get(browser);
    if (leaving && leaving !== nodeId) {
      await this.#captureFlushed(leaving, browser);
    }

    let restored = null;
    if (node.form_state) {
      try {
        restored = JSON.parse(node.form_state);
      } catch (e) {
        restored = null;
      }
    }

    const entry = restored?.entry ?? {
      url: node.url,
      title: node.title ?? undefined,
      triggeringPrincipal_base64: lazy.E10SUtils.SERIALIZED_SYSTEMPRINCIPAL,
    };

    // Both of these happen before the load, so there is no window in which a
    // progress notification can see a stale current node.
    this.#restoring.set(browser, { nodeId, url: entry.url ?? node.url });
    this.#trailByBrowser.set(browser, node.trail_id);
    this.#setCurrent(browser, nodeId);

    lazy.SessionStore.setTabState(tab, {
      entries: [entry],
      index: 1,
      scroll: restored?.scroll ?? undefined,
      formdata: restored?.formdata ?? undefined,
    });
    this.store.restore(nodeId);
    this.#changed();
    return true;
  }

  // ---- verbs --------------------------------------------------------------

  /**
   * Bind pillar B's verbs and mark its nodes.
   *
   * Two calls is all a pillar needs, per the command bar's contract: register
   * objects so they are addressable, register verbs so they run.
   *
   * @param {object} bar An `FOSCommandBar`.
   * @returns {FOSTrailSession} This session.
   */
  wire(bar) {
    this.attach({ marks: bar.marks });

    bar.actions.register("up", () => {
      const node = this.#requireCurrent();
      return node?.parent_id ? this.enter(node.parent_id) : false;
    });

    // `back` is time, `up` is structure. Going to the node you were on a moment
    // ago and going to the node above you in the tree are different questions,
    // and after a branch they have different answers; collapsing them onto one
    // word would make one of the two unreachable.
    bar.actions.register("back", cmd => {
      const target = this.#targetNode(cmd) ?? this.#previousNode();
      return target ? this.enter(target) : false;
    });

    bar.actions.register("branch", () => {
      const node = this.#requireCurrent();
      if (!node) {
        return false;
      }
      const id = this.store.branch(node.id, {
        url: node.url,
        title: node.title,
      });
      this.#setCurrent(this.#window.gBrowser.selectedBrowser, id);
      this.#syncMarks();
      this.#changed();
      return id;
    });

    // `graft <mark>` reattaches the node you are on under the node you named.
    // One mark is enough because the other operand is always where you are,
    // which is also what keeps it to a single spoken phrase.
    bar.actions.register("graft", cmd => {
      const onto = this.#targetNode(cmd);
      const node = this.#requireCurrent();
      if (!onto || !node) {
        return false;
      }
      this.store.graft(node.id, onto);
      this.#changed();
      return true;
    });

    bar.actions.register("name", cmd => {
      const text = String(cmd.text ?? "").trim();
      if (!text) {
        return false;
      }
      const target = this.#targetNode(cmd);
      if (target === null) {
        // No mark names the active trail, which is the common case: a trail is
        // the thing worth naming and the user is usually already on it.
        if (this.#activeTrailId === null) {
          return false;
        }
        this.store.nameTrail(this.#activeTrailId, text);
      } else {
        const node = this.store.getNode(target);
        if (!node) {
          return false;
        }
        node.title = text;
      }
      this.#syncMarks();
      this.#changed();
      return true;
    });

    this.#syncMarks();
    return this;
  }

  /**
   * The node a command's mark names, or null when it carries none.
   *
   * @param {object} cmd A parsed command.
   * @returns {?number} A node id.
   */
  #targetNode(cmd) {
    if (!cmd?.target || !this.#marks) {
      return null;
    }
    return nodeIdFromKey(this.#marks.objectAt(cmd.target));
  }

  #requireCurrent() {
    const id = this.currentNodeId;
    return id === null ? null : this.store.getNode(id);
  }

  /** The node visited before the current one, skipping repeats. */
  #previousNode() {
    for (let i = this.#recent.length - 2; i >= 0; i--) {
      if (this.#recent[i] !== this.currentNodeId) {
        return this.#recent[i];
      }
    }
    return null;
  }

  // ---- internal -----------------------------------------------------------

  #setCurrent(browser, nodeId) {
    this.#nodeByBrowser.set(browser, nodeId);
    const node = this.store.getNode(nodeId);
    if (node) {
      this.#trailByBrowser.set(browser, node.trail_id);
      if (node.trail_id !== this.#activeTrailId) {
        this.#activeTrailId = node.trail_id;
      }
    }
    this.#recent.push(nodeId);
    if (this.#recent.length > 200) {
      this.#recent.splice(0, this.#recent.length - 200);
    }
    this.#syncMarks();
  }

  /**
   * Mark the active trail's nodes, and free letters the trail no longer holds.
   *
   * Marks go to the whole active trail rather than to the rows the rail happens
   * to be showing. `GRAMMAR.md` §2 makes stickiness the rule that gives marks
   * their value, and a mark that changed whenever a subtree was collapsed or
   * the rail was scrolled would be a positional label with extra steps — the
   * exact thing that section rejects. A trail is a bounded set, so this is
   * within the 26 letters in the ordinary case; past that `assign` returns null
   * and those nodes are reached by search, which §2 already specifies.
   */
  #syncMarks() {
    if (!this.#marks || this.#activeTrailId === null) {
      return;
    }
    // Two ranks, and the order is the rule. The trail you are on is what the
    // rail shows and what `back` and `graft` address, so its nodes are marked
    // first and, when the alphabet is full, are allowed to take a letter back
    // from a retained page in some other trail. Retention is a claim on a
    // letter, not a guarantee of one: a Field holding forty cards must not be
    // able to leave the page under the cursor unaddressable.
    const primary = this.store.nodes(this.#activeTrailId).map(n => n.id);
    const inPrimary = new Set(primary);
    const secondary = [];
    for (const supplier of this.#retainers) {
      for (const id of supplier()) {
        if (!inPrimary.has(id)) {
          secondary.push(id);
        }
      }
    }

    const live = new Set();
    for (const id of [...primary, ...secondary]) {
      const node = this.store.getNode(id);
      if (!node) {
        continue;
      }
      const key = nodeKey(node.id);
      if (live.has(key)) {
        continue;
      }
      live.add(key);
      if (inPrimary.has(id) && !this.#marks.markOf(key)) {
        this.#evictForPrimary(inPrimary);
      }
      this.#marks.assign(key, {
        // The label the rail shows, never the raw URL. A mark is assigned the
        // moment a node is created, which is before the title arrives, so
        // deriving it from the URL meant deriving it from "https://" — the
        // first four nodes of every session took h, t, p and s, and stickiness
        // then made that permanent. Mnemonic marks were the entire argument for
        // deriving a letter from the object instead of assigning one in order.
        label: labelFor(node),
        type: "node",
      });
    }
    for (const key of this.#markedNodes) {
      if (!live.has(key)) {
        this.#marks.release(key);
      }
    }
    this.#markedNodes = live;
  }

  /**
   * Free one letter for a node of the active trail, if the alphabet is full.
   *
   * The victim is a marked node outside the active trail — a retained one, held
   * for a surface that addresses pages across trails — and the least recently
   * visited of those, because that is the page least likely to be reached for
   * next. Nothing in the active trail is ever a victim, and the page loses only
   * its letter: it is still on its trail, still on the Field, and still
   * reachable by search, which is what `GRAMMAR.md` §2 already says happens
   * past twenty-six.
   *
   * @param {Set<number>} protectedIds Node ids that may not be evicted.
   */
  #evictForPrimary(protectedIds) {
    let victim = null;
    for (const key of this.#markedNodes) {
      const id = nodeIdFromKey(key);
      if (id === null || protectedIds.has(id) || !this.#marks.markOf(key)) {
        continue;
      }
      const node = this.store.getNode(id);
      if (!node) {
        this.#marks.release(key);
        return;
      }
      if (!victim || node.last_visited_at < victim.at) {
        victim = { key, at: node.last_visited_at };
      }
    }
    if (victim) {
      this.#marks.release(victim.key);
      this.#markedNodes.delete(victim.key);
    }
  }

  #changed() {
    for (const listener of this.#listeners) {
      try {
        listener(this);
      } catch (e) {
        console.error("FOSTrailSession listener failed", e);
      }
    }
  }
}
