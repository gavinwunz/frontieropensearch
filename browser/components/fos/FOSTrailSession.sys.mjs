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
  #settles = new Set();
  #restoring = new WeakMap();
  // Which node each of a browser's session history entries stands for, keyed
  // by index. Session history is Gecko's linear record of the same walk this
  // component records as a tree, and the two stay one-to-one because re-entry
  // replaces the whole history with a single entry (see `enter`) — so every
  // entry above index 0 was appended by a navigation that also added a node.
  // Kept so that a traversal can find the node it is landing on rather than
  // inventing one; see the `LOAD_CMD_HISTORY` branch in `onLocationChange`.
  #historyByBrowser = new WeakMap();
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
   * Departures come from two places and they are not equally good. A page
   * navigated away from by a click is announced from the progress listener, at
   * the instant the next load starts, and that is a race a listener can lose —
   * so a listener has to prove what it read was the document it was told
   * about. A page left by `enter` is announced before anything has started to
   * move, and there a returned promise is awaited: that path is exact.
   *
   * @param {Function} listener Called as `(nodeId, browser)`. May return a
   *   promise, which the deliberate paths await and the progress listener
   *   ignores.
   * @returns {Function} An unsubscribe function.
   */
  onDeparture(listener) {
    this.#departures.add(listener);
    return () => this.#departures.delete(listener);
  }

  /**
   * Be told when a page has finished loading, on the browser still showing it.
   *
   * The counterpart to `onDeparture`, and the answer to the same problem that
   * `#backfillPrevious` solves for the scroll offset: departure is the
   * intuitive moment and it is routinely too late. By the time a cross-process
   * load starts, the outgoing page's browser can already have been swapped to
   * `about:blank`, so a snapshot taken there is of nothing — measured on this
   * build, not assumed. A settled page cannot be raced, and it is the only
   * moment available for a page that is closed rather than navigated away.
   *
   * Scroll state has no equivalent need, because history keeps it and pixels
   * are not kept anywhere.
   *
   * @param {Function} listener Called as `(nodeId, browser)`.
   * @returns {Function} An unsubscribe function.
   */
  onSettled(listener) {
    this.#settles.add(listener);
    return () => this.#settles.delete(listener);
  }

  /**
   * @param {number} nodeId The node being left.
   * @param {object} browser The browser leaving it.
   * @returns {Promise<void>} Settles when every listener has.
   */
  #departed(nodeId, browser) {
    return this.#notify(this.#departures, nodeId, browser);
  }

  /**
   * @param {Set<Function>} listeners Either listener set.
   * @param {number} nodeId The node concerned.
   * @param {object} browser The browser showing it.
   * @returns {Promise<void>} Settles when every listener has. The progress
   *   listener drops this on the floor — it must not hold up a load — but the
   *   deliberate paths await it, because there the outgoing document is still
   *   in front of us and waiting is what makes the capture certain instead of
   *   a race.
   */
  #notify(listeners, nodeId, browser) {
    const pending = [];
    for (const listener of listeners) {
      try {
        pending.push(listener(nodeId, browser));
      } catch (e) {
        // A listener that throws must not stop the navigation it is watching.
        console.error(e);
      }
    }
    return Promise.allSettled(pending).then(() => {});
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

  /**
   * Put a previous session's trails back into this window's tree.
   *
   * The Context Engine owns the reading — it is the half that knows the
   * database — and this owns what a restored trail *means* to the window:
   * subscribers are told, and the newest restored trail becomes the active one
   * so its nodes take marks and the rail has something to draw. That last part
   * is not cosmetic. No browser is on any restored trail, so nothing else will
   * ever make one active, and a trail nobody can address is a trail that came
   * back only as far as the Field. The first navigation in a tab still opens a
   * trail of its own and takes the active slot back, which is unchanged: the
   * restored trail is what the user is looking at, not what they are on.
   *
   * @param {object} records `{trails, nodes}` rows, as `TrailStore.hydrate`
   *   takes them.
   * @returns {{trails: Map<number, number>, nodes: Map<number, number>}}
   */
  hydrate(records) {
    const ids = this.store.hydrate(records);
    if (this.#activeTrailId === null) {
      let newest = null;
      for (const trail of this.store.trails()) {
        // A finished trail is exactly the one not to land on. `restorable()`
        // already keeps it out of the records, so this only bites when
        // something else hydrated it — but resuming onto a trail the user
        // closed would undo the verb silently, which is worse than the cost of
        // one check.
        if (trail.archived_at !== null) {
          continue;
        }
        if (!newest || trail.updated_at > newest.updated_at) {
          newest = trail;
        }
      }
      if (newest) {
        this.#activeTrailId = newest.id;
        this.#syncMarks();
      }
    }
    this.#changed();
    return ids;
  }

  /**
   * Take pages out of this window's live tree, because their record has gone.
   *
   * The other half of `FOSForget`. The store's delete is what the privacy
   * claim rests on, but the tree the rail draws and the cards on the Field are
   * in-memory objects built during the session: without this a page forgotten
   * while it was on screen stayed on screen until the browser was restarted,
   * and every later navigation from it wrote rows pointing at a node that no
   * longer existed.
   *
   * **The tab is not closed.** A page open when its site is forgotten keeps
   * its document, its scroll position and anything typed into it; what goes is
   * the *record* of it. That is Firefox's own answer rather than an invention
   * — `SessionStore.onPurgeDomainData` drops every closed tab and every tab of
   * a closed window matching the domain and does not touch an open one — and
   * it is the right one twice over: closing a tab is a data-loss surprise from
   * a menu item that promised to delete data, and the user may well be reading
   * the page they have just decided not to keep a record of.
   *
   * The tab is left **unrecorded** instead. Its browser loses its node, so no
   * dwell accrues and no scroll offset is written for what is still on screen.
   * Navigating onward from it starts recording again — forgetting is a delete,
   * not a blocklist, and Forget About This Site is not one either; a user who
   * wants a session that records nothing has a private window.
   *
   * @param {Iterable<number>} nodeIds Nodes to remove, by in-memory id.
   * @returns {{nodes: number[], trails: number[]}} What actually went.
   */
  forget(nodeIds) {
    const gone = this.store.forget(nodeIds);
    if (!gone.nodes.length) {
      return gone;
    }
    const nodes = new Set(gone.nodes);
    const trails = new Set(gone.trails);

    for (const tab of this.#window.gBrowser?.tabs ?? []) {
      const browser = tab.linkedBrowser;
      if (nodes.has(this.#nodeByBrowser.get(browser))) {
        this.#nodeByBrowser.delete(browser);
      }
      if (trails.has(this.#trailByBrowser.get(browser))) {
        this.#trailByBrowser.delete(browser);
      }
    }

    // `back` walks this, and a forgotten id in it is a page `enter` would
    // throw on.
    this.#recent = this.#recent.filter(id => !nodes.has(id));
    if (trails.has(this.#activeTrailId)) {
      this.#activeTrailId = null;
    }

    // Released here rather than left to `#syncMarks`, which returns early when
    // there is no active trail — which is exactly the case where a whole trail
    // has just been forgotten, and exactly when the stale letters would be
    // most confusing. The sync that follows hands the freed letters out again.
    for (const id of nodes) {
      const key = nodeKey(id);
      if (this.#markedNodes.delete(key)) {
        this.#marks?.release(key);
      }
    }
    this.#syncMarks();
    this.#changed();
    return gone;
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
      const settled = this.#nodeByBrowser.get(browser);
      if (settled) {
        this.#notify(this.#settles, settled, browser);
      }
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
        // Re-entry hands the tab a one-entry history, so the node being
        // restored is what index 0 now stands for. Recorded here rather than in
        // `enter` because this is the point at which the new history exists,
        // which keeps the map written from one function only.
        this.#recordHistoryEntry(browser, restoring.nodeId);
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

    // A step through session history is a *move*, not a visit. Nothing else on
    // this path can tell the two apart: a back arrives here with a committed
    // top-level load to a URL the browser is not currently at, which is the
    // exact shape of a click, so the rule below spawned a child for it — and
    // the child duplicated the page the user had just come from, under the page
    // they were leaving. The tree then recorded a journey nobody made, one node
    // deeper on every press, and `up` walked the fiction. This is the same
    // defect the `#restoring` flag above exists to prevent for re-entry; it was
    // fixed there for this component's own verb and left standing for the four
    // gestures Firefox binds to the same movement.
    //
    // `loadType` is the signal rather than the URL, because a link back to the
    // page above you is a real visit and has to stay one. `nsIWebProgress`
    // carries the docshell's load command, and `LOAD_CMD_HISTORY` covers back,
    // forward and any `gotoIndex` — including `history.back()` called by the
    // page itself, which is why this cannot be a hook on `Browser:Back`.
    //
    // A traversal to an index with no node is possible — a `pushState` entry
    // has no node of its own — so an unknown index falls through and is
    // recorded as a visit, which is what this did for every traversal before.
    if (webProgress.loadType & Ci.nsIDocShell.LOAD_CMD_HISTORY) {
      const landed = this.#historyNode(browser);
      if (landed !== null) {
        this.#setCurrent(browser, landed);
        this.#changed();
        return;
      }
    }

    // A load that ends where the browser already is is not a new page. Two
    // things arrive here looking like one: a reload, and the second half of a
    // process switch — restoring an https page into a tab showing about:blank
    // fires one location change in the old process and another in the new one,
    // and the restore flag above is spent on the first. Found by re-entering a
    // restored node in a freshly started browser, which is the first thing
    // anyone does after a restart: the trail quietly grew a second copy of the
    // page it had just put back.
    const current = currentId === null ? null : this.store.getNode(currentId);
    if (current && current.url === location.spec) {
      this.#changed();
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
    this.#recordHistoryEntry(browser, nodeId);
    this.#changed();
  }

  /**
   * The node the browser's current session history entry stands for.
   *
   * @param {object} browser The browser element.
   * @returns {?number} The node id, or null if this entry has no node.
   */
  #historyNode(browser) {
    const index = browser.browsingContext?.sessionHistory?.index;
    if (typeof index !== "number") {
      return null;
    }
    const nodeId = this.#historyByBrowser.get(browser)?.get(index) ?? null;
    // A node can be forgotten while its history entry is still there, and a
    // traversal onto one must not put the window on a node the store has
    // dropped — `#setCurrent` would re-derive a trail from nothing.
    return nodeId !== null && this.store.getNode(nodeId) ? nodeId : null;
  }

  /**
   * Note which node a browser's current history entry stands for.
   *
   * @param {object} browser The browser element.
   * @param {number} nodeId The node just created for it.
   */
  #recordHistoryEntry(browser, nodeId) {
    const index = browser.browsingContext?.sessionHistory?.index;
    if (typeof index !== "number") {
      return;
    }
    let entries = this.#historyByBrowser.get(browser);
    if (!entries) {
      entries = new Map();
      this.#historyByBrowser.set(browser, entries);
    }
    // Stale entries are left rather than pruned, and that is a claim worth
    // stating because it looks like an oversight. Navigating away from a
    // mid-history position does drop every session history entry above it, and
    // the map goes on describing pages this browser can no longer reach — but
    // no read can reach them either. An index is only readable by traversing
    // to it, which needs a session history entry there, and the navigation
    // that created that entry came through this method first. A pruning pass
    // was written, and removed when no mutation of it could be made to fail.
    //
    // The one way to reach an index without writing it is a page that gets no
    // node at all: `isCapturable` refuses `about:blank` and the new tab page.
    // That is safe for the same reason it is silent — the guard is above every
    // branch here, so a traversal *onto* such a page returns before consulting
    // the map, exactly as the navigation onto it did.
    entries.set(index, nodeId);
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
        // A tab loading a page labels itself with that page's URL until the
        // title arrives, so the label is a fallback for a node that has no
        // title at all and never a replacement for one that has. Restoring
        // made the difference visible: a node came back from the database
        // titled "Example Domain" and re-entering it wrote "example.org/" over
        // the top.
        const title =
          tab.linkedBrowser.contentTitle || (node.title ? null : tab.label);
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
      // Both halves of leaving a page, and this is the one path that gets to
      // do them properly. Re-entry is the deliberate departure: nothing has
      // started to move, so the outgoing document is still live and still
      // painted, and a snapshot taken here cannot lose a race because there is
      // no race to lose.
      //
      // The progress-listener path cannot notify departure here — it is
      // suppressed by `#restoring`, correctly, because the load `enter` is
      // about to start belongs to the node being *arrived* at. That left
      // re-entry as the one way to leave a page that took no picture of it,
      // and it is the way this browser is designed to be used: branch, go
      // back, branch again. Every page you branched from stayed blank in the
      // Field while the page you never left kept its snapshot — visible in
      // `agent/reports/demo-3-field-region.png`, where the three children of
      // the search are grey and the search itself is not.
      //
      // Concurrently rather than in sequence, because they read the same
      // document by different routes and neither writes it: the cost of
      // re-entry goes up by the slower of the two, not by their sum.
      await Promise.all([
        this.#captureFlushed(leaving, browser),
        this.#departed(leaving, browser),
      ]);
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
    // Walking back into a finished trail is how `done` is undone. The context
    // sidebar and the bar both re-enter nodes by database id, and an archived
    // trail's nodes are still in this session's tree, so without this the user
    // ends up standing on a trail that is still archived — extending work that
    // will never be offered back, with nothing on screen saying so.
    this.store.resumeTrail(node.trail_id);
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

    bar.actions.register("done", () => this.finishTrail());

    this.#syncMarks();
    return this;
  }

  /**
   * `done`: finish the trail the user is on.
   *
   * Three things happen and no more. The trail is marked archived, so
   * `restorable()` stops offering it back. Every browser sitting on it forgets
   * that it was, so the next page opened there starts a fresh trail rather than
   * adding to one its owner has called finished. And the recency list drops its
   * nodes, because `back` walks that list and a finished trail is not somewhere
   * to be walked into.
   *
   * Nothing is deleted and nothing is written to a node. The tab stays open on
   * the page it is showing — `done` is a statement about the thread, not about
   * the window, and closing what the user is reading because they filed it away
   * would be the verb taking a liberty nobody asked for.
   *
   * An empty trail is refused rather than archived. There is nothing to finish,
   * and archiving it would spend the user's word on a no-op while leaving them
   * on a trail that is now invisible to the thing that restores it.
   *
   * @returns {boolean} Whether a trail was finished.
   */
  finishTrail() {
    // No archived check, and the mutation pass is why. It was here first, it
    // could not be made to fail, and the reason turned out to be a bug rather
    // than caution: re-entry used to leave the user on a trail that was still
    // archived, which was the only way `#activeTrailId` could name one. Fixing
    // that — `enter` resumes the trail — made the branch genuinely unreachable,
    // so it goes. `archiveTrail` is idempotent if anything ever proves this
    // wrong.
    const trailId = this.#activeTrailId;
    if (trailId === null) {
      return false;
    }
    const nodes = this.store.nodes(trailId);
    if (!nodes.length) {
      return false;
    }

    this.store.archiveTrail(trailId);

    for (const tab of this.#window.gBrowser?.tabs ?? []) {
      const browser = tab.linkedBrowser;
      if (this.#trailByBrowser.get(browser) === trailId) {
        this.#trailByBrowser.delete(browser);
        this.#nodeByBrowser.delete(browser);
      }
    }

    const finished = new Set(nodes.map(n => n.id));
    this.#recent = this.#recent.filter(id => !finished.has(id));
    this.#activeTrailId = null;

    this.#syncMarks();
    this.#changed();
    return true;
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
    }

    // A page that loads where the user is not looking gets a node, a trail and
    // a card, and moves nothing else. `onLocationChange` fires for every
    // browser in the window, so without this a background arrival became "where
    // you are": the active trail followed it, and with it the marks, the
    // context sidebar, what `name` names, and the tiers the command bar ranks
    // by. The letters under the user's eyes would change because a page they
    // never looked at finished loading — which is the one thing GRAMMAR.md §2's
    // stickiness rule exists to prevent. `TabSelect` is what moves the active
    // trail, because selecting a tab is the user saying where they are.
    if (browser !== this.#window.gBrowser?.selectedBrowser) {
      // Marks still get synced: an arrival on the *active* trail is a node the
      // rail is about to show, and it needs its letter.
      this.#syncMarks();
      return;
    }

    if (node && node.trail_id !== this.#activeTrailId) {
      this.#activeTrailId = node.trail_id;
    }
    // Only pages the user was on join the recency list, since it is what `back`
    // walks: a background arrival in it would send `back` to a page nobody read.
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
   *
   * Which nodes lose out past twenty-six is the whole question. A trail is
   * bounded but not small — an afternoon on one line of enquiry passes
   * twenty-six pages easily — and the nodes are visited in order, so first
   * come, first served hands every letter to the pages you opened first and
   * leaves the page you are on unaddressable. That is the failure this method
   * exists to prevent, and it arrived from the trail itself rather than from
   * the Field. So the active trail is considered most recently visited first,
   * and a page may take a letter back from an *older page of its own trail*
   * when there is nothing retained left to take.
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
    // Most recently visited first, so that when the alphabet runs out it runs
    // out on the pages furthest behind you rather than on the one in front of
    // you. Stickiness is unaffected: order decides who gets a letter when they
    // are scarce, never which letter, and a node that already holds one keeps
    // it wherever it sorts.
    const primary = this.store
      .nodes(this.#activeTrailId)
      .slice()
      .sort((a, b) => (b.last_visited_at ?? 0) - (a.last_visited_at ?? 0))
      .map(n => n.id);
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
      if (inPrimary.has(id) && !this.#marks.markOf(key)) {
        // `live` is every key this pass has already reached, and nothing in it
        // may be a victim: those are the nodes ahead of this one in the order
        // above, which is to say the more recent ones.
        this.#evictForPrimary(node, inPrimary, live);
      }
      live.add(key);
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
   * Two ranks of victim, tried in order. First a marked node outside the active
   * trail — a retained one, held for a surface that addresses pages across
   * trails — because a claim made on behalf of a card is weaker than a claim
   * made by the trail you are reading. Then, only when there is no retained
   * letter left to take, an older page of the active trail itself: a trail past
   * twenty-six pages otherwise spends its whole alphabet on the pages it opened
   * first, and the page you are on is the one that cannot be addressed.
   *
   * Both ranks take the least recently visited candidate, as the page least
   * likely to be reached for next, and neither will take a letter from a page
   * more recent than the one asking — which is what stops the letters churning
   * between old nodes on every navigation. A page loses only its letter: it is
   * still on its trail, still on the Field, and still reachable by search,
   * which is what `GRAMMAR.md` §2 already says happens past twenty-six.
   *
   * @param {object} claimant The node that needs a letter.
   * @param {Set<number>} inPrimary Node ids of the active trail.
   * @param {Set<string>} protectedKeys Keys marked earlier in this pass.
   */
  #evictForPrimary(claimant, inPrimary, protectedKeys) {
    let retained = null;
    let older = null;
    for (const key of this.#markedNodes) {
      const id = nodeIdFromKey(key);
      if (id === null || protectedKeys.has(key) || !this.#marks.markOf(key)) {
        continue;
      }
      const node = this.store.getNode(id);
      if (!node) {
        // A marked key with no node behind it is a letter held by nothing.
        this.#marks.release(key);
        this.#markedNodes.delete(key);
        return;
      }
      const at = node.last_visited_at ?? 0;
      if (!inPrimary.has(id)) {
        if (!retained || at < retained.at) {
          retained = { key, at };
        }
      } else if (id !== claimant.id && at < (claimant.last_visited_at ?? 0)) {
        if (!older || at < older.at) {
          older = { key, at };
        }
      }
    }
    const victim = retained ?? older;
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
