/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Field: pillar A's surface, and what replaces the tab strip.
 *
 * The model in `FOSField.sys.mjs` decides where every card goes and refuses
 * anything that would break `FIELD.md`'s invariants; the layout arithmetic is
 * in `FOSFieldView.sys.mjs` and runs under plain node. What is left here is the
 * part only Gecko can do: page thumbnails, the DOM, pointer capture, and
 * turning "enter this card" into a tab selection and a session restore.
 *
 * Two things are worth knowing before reading it.
 *
 * **The Field is fed by the trail session, not by the tab strip.** A card
 * exists for every live node in the captured tree, so pages reach the Field by
 * having been navigated to, not by being open in a tab. That is what makes
 * dismissal free (§8): dropping a card closes nothing and loses nothing,
 * because the page's scroll offset and form state are already on its trail.
 *
 * **Nothing here decides placement.** Every position comes from the model, and
 * the model's rule is provenance and nothing else (§4). This file must never
 * acquire a "tidy up" path — the invariant that the system never moves a card
 * the user placed is the whole reason the Field is not a prettier tab strip.
 */

import { FieldModel } from "./FOSField.sys.mjs";
import {
  FOSTrailSession,
  nodeIdFromKey,
  nodeKey,
} from "./FOSTrailSession.sys.mjs";
import {
  LEVEL,
  VIEW_METRICS,
  cardCaption,
  lineageCards,
  miniScale,
  miniTransform,
  moveFocus,
  overviewLayout,
  pointerToField,
  regionLayout,
} from "./FOSFieldView.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PageThumbs: "resource://gre/modules/PageThumbs.sys.mjs",
});

import { ensureStylesheet, releaseFocus, takeFocus } from "./FOSChrome.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-field.css";

/**
 * How many snapshots to keep. A card is a cached snapshot rather than a live
 * browser (§7), so this is the entire memory cost of the Field: a few kilobytes
 * of JPEG each, evicted oldest-first.
 */
const THUMBNAIL_CACHE = 256;

/** Capture at twice the card's size, so a card is not soft on a HiDPI display. */
const THUMBNAIL_SCALE = 2;

/**
 * How long after a page settles to take its picture.
 *
 * The same second Firefox waits before capturing a top site, and for the same
 * reason: a page that has just fired its load event is often still laying
 * itself out, and a thumbnail of a half-drawn page is worse than none.
 */
const SETTLE_DELAY_MS = 1000;

/** One Field per chrome window. */
// eslint-disable-next-line jsdoc/require-jsdoc
const byWindow = new WeakMap();

/**
 * The card id under a pointer event, or null.
 *
 * @param {Event} event
 * @returns {?number}
 */
function cardIdFromEvent(event) {
  const el = event.target?.closest?.(".fos-field-card");
  return el ? Number(el.dataset.cardId) : null;
}

/**
 *
 */
export class FOSFieldSurface {
  /**
   * The Field for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSFieldSurface}
   */
  static forWindow(window) {
    let field = byWindow.get(window);
    if (!field) {
      field = new FOSFieldSurface(window);
      byWindow.set(window, field);
    }
    return field;
  }

  #window;
  #session;
  #model = null;
  #marks = null;

  #root = null;
  #stage = null;
  #crumbs = null;
  #status = null;

  #level = LEVEL.PAGE;
  #regionId = null;
  #focus = null;
  #layout = null;
  #drag = null;
  #unsubscribe = null;
  #resizeFrame = 0;
  #resizePasses = 0;

  /** Whether anything has arrived since the Field was last looked at. */
  #unseen = false;
  #unseenListeners = new Set();
  /** Called with `{nodeId, x, y}` when the user finishes placing a card. */
  #placementListeners = new Set();
  /**
   * Saved placements whose card is not on the Field yet, by node id.
   *
   * Restoration is async — pillar C opens a database — and a card is placed by
   * the sync that the tree's own restore triggers, so in practice the cards are
   * already here. This is what makes the order not matter anyway.
   */
  #pendingPlacements = new Map();
  /** The nodes that arrived while the Field was shut, until it is shut again. */
  #arrived = new Set();
  /** When this window started watching, so a restored page is not an arrival. */
  #watchingSince = Infinity;

  /** node id -> data URL. */
  #thumbs = new Map();

  /**
   * page url -> a `moz-page-thumb://` URL, or null when nothing is on disk.
   *
   * The memory cache above dies with the process; this one is the answer for a
   * card whose page has not been visited since the browser started, which after
   * the trail restore is most of them.
   */
  #stored = new Map();

  constructor(window) {
    this.#window = window;
    this.#session = FOSTrailSession.forWindow(window);
  }

  /** The card and region model. Tests read this. */
  get model() {
    if (!this.#model) {
      this.#model = new FieldModel({ trails: this.#session.store });
    }
    return this.#model;
  }

  /** Which of `FIELD.md` §3's three levels is showing. */
  get level() {
    return this.#level;
  }

  /** The region being shown at the region level, or null. */
  get regionId() {
    return this.#regionId;
  }

  get isOpen() {
    return !!this.#root && !this.#root.hidden;
  }

  /** The Field's stage element, or null before first open. Tests read this. */
  get stage() {
    return this.#stage;
  }

  /** The focused card or region id. Tests read this. */
  get focus() {
    return this.#focus;
  }

  /**
   * Stop watching the trail store. Nothing calls this yet — a chrome window's
   * modules die with the window — but the subscription is real, so the way to
   * end it should be too rather than left implicit.
   */
  detach() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#resizeFrame) {
      this.#window.cancelAnimationFrame(this.#resizeFrame);
      this.#resizeFrame = 0;
    }
  }

  /**
   * How many coalesced resize passes have run. Tests read this; nothing else
   * does.
   *
   * Counting passes rather than renders is what survived the reposition path:
   * a pass now does one of two things, and the claim the coalescing makes —
   * one pass per frame, however many events arrive — is about neither of them
   * in particular.
   */
  get resizePasses() {
    return this.#resizePasses;
  }

  /** The card ids currently rendered, in DOM order. Tests read this. */
  get renderedCardIds() {
    return [...(this.#stage?.querySelectorAll(".fos-field-card") ?? [])].map(
      el => Number(el.dataset.cardId)
    );
  }

  // ---- verbs --------------------------------------------------------------

  /**
   * Bind pillar A's verbs and mark its cards.
   *
   * The same two calls every pillar makes: register objects so they are
   * addressable, register verbs so they run.
   *
   * @param {object} bar An `FOSCommandBar`.
   * @returns {FOSFieldSurface} This Field.
   */
  wire(bar) {
    this.#marks = bar.marks;
    // Built now rather than on first open, because the model has to be
    // accumulating cards from the first navigation — a Field that only starts
    // watching when you look at it would open empty on the pages you already
    // have, which is the one moment it most needs to be right.
    this.model;
    this.#unsubscribe ??= this.#session.subscribe(() => this.sync());
    // Stamped before the first sync, because everything already in the store
    // at this moment is a page from a previous session being put back, and a
    // restart is not an arrival. Without this the signal would be lit on every
    // start, which is how a badge teaches people to stop reading it.
    this.#watchingSince = Date.now();
    // A page carries one mark and it belongs to its node, so the Field does not
    // assign any — it tells pillar B which pages it is holding, and pillar B
    // keeps those marked even when their trail is not the active one. Without
    // this a card in another region would be unaddressable, which is most of
    // what the Field is for.
    this.#session.retain(() => this.model.cards().map(card => card.node_id));
    // §7: captured on navigation. A page that has been navigated away from has
    // no browser behind it any more, so capturing only on the way into the
    // Field left every card but the current one blank — and a card without a
    // thumbnail is a list entry with extra steps, which is the condition Data
    // Mountain measured as its *weakest*.
    this.#session.onDeparture((nodeId, browser) =>
      this.#capture(browser, nodeId)
    );
    // And when the page settles, which is the floor under the line above. A
    // departure capture is the better picture — it is the page as you left it,
    // scrolled to where you were reading — but it is a race against the
    // process swap and on this build it usually loses, so relying on it alone
    // left most pages with no snapshot at all and nothing to write to disk.
    //
    // Twice, and the first one is the point. Waiting a second before the
    // picture is right — a page that has just fired its load event is often
    // still laying itself out — but it assumes the user is still there in a
    // second, and the page they are least likely to still be on is the one
    // they are *searching from*. Branch off a result within the second and the
    // delayed capture is discarded as stale while the departure that follows
    // has already lost its document, so the one card the eye goes to was the
    // one card with nothing on it: three branches with pictures around a grey
    // rectangle, in `agent/reports/demo-3-field-region.png`.
    //
    // So a node with no picture at all takes one immediately, half-drawn and
    // all, and a node that already has one waits for the better one. That is
    // Data Mountain's finding applied to its own edge case — a thumbnail is
    // what makes a card more than a list row, and a rough thumbnail is much
    // closer to a good one than to none. It also costs nothing on any page
    // that has been seen before, which is most of them.
    this.#session.onSettled((nodeId, browser) => {
      if (!this.#thumbs.has(nodeId)) {
        this.#capture(browser, nodeId);
      }
      this.#window.setTimeout(() => {
        // The page may have been navigated on, or the tab closed, in the
        // second we waited; capturing then would file the wrong picture.
        if (this.#session.nodeForBrowser(browser) === nodeId) {
          this.#capture(browser, nodeId);
        }
      }, SETTLE_DELAY_MS);
    });
    this.sync();

    bar.actions.register("field", () => {
      this.open();
      return true;
    });

    // `enter` is the only verb that leaves the Field, and it is deliberately
    // the same word whether the target is a card in this trail or one three
    // trails away: the card is the address, and which tab it lives in is
    // bookkeeping the user should never have to hold.
    bar.actions.register("enter", cmd => {
      const nodeId = this.#targetNode(cmd);
      return nodeId === null ? false : this.enterNode(nodeId);
    });

    bar.actions.register("dismiss", cmd => {
      const nodeId = this.#targetNode(cmd);
      const card = nodeId === null ? null : this.model.cardForNode(nodeId);
      return card === null ? false : this.dismissCard(card.id);
    });

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

  /**
   * The mark on a card, which is its page's mark.
   *
   * @param {number} nodeId A node id.
   * @returns {?string} Its mark letter, or null.
   */
  #markFor(nodeId) {
    return this.#marks?.markOf(nodeKey(nodeId)) ?? null;
  }

  // ---- the model ----------------------------------------------------------

  /**
   * Give every live node a card.
   *
   * Placement is driven by navigation and must never fail (§6, capacity), so
   * this deliberately does not guard against a full region — the model's answer
   * to that is to evict one unpinned card or grow, and both are correct here.
   * What it does guard against is a node with no trail, which happens for a
   * moment during startup.
   */
  sync() {
    const model = this.model;
    let changed = false;
    let arrived = false;
    // The page this window is actually showing. A card placed for it is the
    // navigation the user just made and is by definition seen; every other
    // card placed in the same pass arrived somewhere they were not looking.
    const current = this.#session.currentNodeId;

    // `done` first, and before anything is placed. A finished trail's region
    // comes off the Field, which is the visible half of the verb: §3 caps the
    // overview at nine and nests the rest by least-recent touch, so until now
    // the only way a slot came free was the system guessing that a trail had
    // been abandoned. Retiring before the placement loop also means a node of a
    // finished trail cannot be placed and retired in the same pass.
    for (const region of model.regions()) {
      // A trail that has gone rather than ended: forgetting deletes the tree
      // it was drawn from, and a region outliving its trail would be a set of
      // cards for pages the browser has just said it no longer has a record
      // of. Checked before `isArchived`, which needs the trail to exist.
      if (
        !this.#session.store.getTrail(region.id) ||
        this.#session.store.isArchived(region.id)
      ) {
        model.retireTrail(region.id);
        changed = true;
        if (this.#regionId === region.id) {
          // Zoomed into the trail that just ended: the overview is the only
          // level left that still describes something. Set rather than call
          // `showOverview`, so the pass renders once at the end like any other.
          this.#level = LEVEL.OVERVIEW;
          this.#regionId = null;
          this.#focus = null;
        }
      }
    }
    // Then cards whose page has gone while its trail stayed — forgetting a
    // host takes pages out of the middle of a trail the rest of which is still
    // there. Dropped rather than dismissed: dismissal is a statement about a
    // page that is still on its trail, and this page is not.
    for (const card of model.cards()) {
      if (!this.#session.store.getNode(card.node_id)) {
        model.drop(card.id);
        changed = true;
      }
    }

    // Focus is a card id at the region level and a region id at the overview,
    // so it has to be checked against both — clearing it by card alone would
    // drop the selection off every tile in the overview whenever any trail was
    // finished.
    if (changed && !this.#focusStillExists()) {
      this.#focus = null;
    }

    for (const node of this.#session.store.nodes()) {
      if (
        node.dismissed_at !== null ||
        model.cardForNode(node.id) ||
        this.#session.store.isArchived(node.trail_id)
      ) {
        continue;
      }
      try {
        model.place(node.id);
        changed = true;
        // A card the previous session had a chosen position for goes straight
        // to it, rather than being seeded and then seen to jump.
        const saved = this.#pendingPlacements.get(node.id);
        if (saved) {
          this.#pendingPlacements.delete(node.id);
          model.pinAt(node.id, saved);
        }
        if (node.id !== current && node.created_at >= this.#watchingSince) {
          arrived = true;
          // Which card, not just that one exists. The dot on the bar says
          // something arrived and the Field is where it went; a canvas of
          // identical cards then makes the user find it, which is the search
          // Iqbal and Horvitz measured as the expensive half of coming back
          // — their subjects tabbed through 7.5 windows looking for the one
          // they had been alerted about. See IDEAS.md, run 32.
          this.#arrived.add(node.id);
        }
      } catch (e) {
        // A node whose trail has gone is not a card; it is not an error
        // either, and it must not take the whole sync down with it.
        console.error(e);
      }
    }
    if (changed && this.isOpen) {
      this.render();
    }
    // Nothing is unseen while the Field is on screen: the arrival was drawn on
    // the render above, in front of the person the signal is for.
    if (arrived && !this.isOpen) {
      this.#setUnseen(true);
    }
  }

  /**
   * Whether `#focus` still names something on the Field.
   *
   * @returns {boolean}
   */
  #focusStillExists() {
    if (this.#focus === null || this.#focus === "nest") {
      return true;
    }
    return (
      !!this.model.getCard(this.#focus) ||
      this.model.regions().some(r => r.id === this.#focus)
    );
  }

  // ---- what arrived while you were not looking ----------------------------

  /**
   * Whether anything has arrived in the Field since it was last opened.
   *
   * The one thing this fork says about a page that loads in the background.
   * The design record settles its form against two literatures and rules out
   * both ends of the obvious range: motion at the window margin captures
   * attention involuntarily, which is the attention shift an ambient display
   * is defined by not requiring, and a slow fade runs into slow change
   * blindness, which survives the change being large, in full view and about
   * something the observer cares about. What is left when an event and a drift
   * are both out is a *state* — a step change that persists, is read on the
   * next voluntary glance, and answers "has anything arrived since I last
   * looked?" at the moment the user chooses to ask it.
   *
   * Binary rather than a count, because a count is only worth rendering if it
   * is worth reading precisely and nobody reads a peripheral number precisely
   * — and because a number that grows is the tab strip's worst property.
   * Cleared by opening the Field rather than by a dismissal, because opening
   * the Field is what the state is *for*: a signal with its own dismiss button
   * is a second thing to do about a page you have not read yet.
   *
   * @returns {boolean}
   */
  get hasUnseen() {
    return this.#unseen;
  }

  /**
   * The nodes that arrived while the Field was shut, as node ids.
   *
   * The per-card half of `hasUnseen`: the boolean says something arrived and
   * this says what. It survives `open` and clears on `close`, because opening
   * the Field is the question and closing it is the answer.
   *
   * @returns {Set<number>} A copy — the caller must not be able to clear it.
   */
  get arrivedNodes() {
    return new Set(this.#arrived);
  }

  /**
   * Watch the unseen state.
   *
   * The Field owns the state because it owns the question — what is on screen
   * carrying it is a matter for whichever surface is persistent, and in this
   * fork's ordinary window that is the retired address bar. So the Field says
   * what is true and says nothing about how it is drawn.
   *
   * @param {Function} listener Called with the new value on every change.
   * @returns {Function} Call it to stop watching.
   */
  onUnseenChange(listener) {
    this.#unseenListeners.add(listener);
    return () => this.#unseenListeners.delete(listener);
  }

  /**
   * Watch for cards the user places.
   *
   * Pillar A does not know what a database is, and this is how it stays that
   * way: the Field says where a card was put, and whoever is listening decides
   * whether that is worth keeping. With nobody listening the Field behaves
   * exactly as it did — which is also what happens when pillar C fails to open
   * its store, and is why a restart with no engine still gives a usable Field.
   *
   * @param {function({nodeId: number, x: number, y: number})} listener
   * @returns {function()} Unsubscribe.
   */
  onPlacement(listener) {
    this.#placementListeners.add(listener);
    return () => this.#placementListeners.delete(listener);
  }

  #emitPlacement(placement) {
    for (const listener of this.#placementListeners) {
      try {
        listener(placement);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /**
   * Put cards back where the user put them in a previous session.
   *
   * §4's "not on restart" clause, and the only caller is pillar C's restore.
   * A placement whose card is not on the Field yet is held rather than dropped,
   * so this does not depend on racing the sync that places it.
   *
   * @param {Map<number, {x: number, y: number}>} byNode Memory node ids.
   */
  restorePlacements(byNode) {
    if (!byNode.size) {
      return;
    }
    const model = this.model;
    let changed = false;
    for (const [nodeId, at] of byNode) {
      if (!model.cardForNode(nodeId)) {
        this.#pendingPlacements.set(nodeId, at);
        continue;
      }
      if (model.pinAt(nodeId, at).ok) {
        changed = true;
      }
    }
    if (changed && this.isOpen) {
      this.render();
    }
  }

  /**
   * @param {boolean} value The new state.
   */
  #setUnseen(value) {
    if (this.#unseen === value) {
      return;
    }
    this.#unseen = value;
    for (const listener of this.#unseenListeners) {
      try {
        listener(value);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ---- levels -------------------------------------------------------------

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  /** Open the Field at the overview: the whole world, scaled to fit. */
  open() {
    this.#build();
    this.sync();
    // After the sync and not before it: the sync above still sees a closed
    // Field, so a page arriving in the same pass sets the state — and it is
    // about to be drawn by this very open. Clearing here covers both that page
    // and everything that arrived before it.
    this.#setUnseen(false);
    this.#root.hidden = false;
    this.showOverview();
    this.#captureOpenTabs();
    takeFocus(this.#window, this, this.#stage);
  }

  /** Leave the Field for the page level. */
  close() {
    if (!this.#root) {
      return;
    }
    // Closing the Field is the user saying they have looked, so the per-card
    // state clears here rather than on `open`. The boolean clears on open
    // because opening is what it asks for; this one has to survive that open,
    // or the surface the dot sends you to could not say what the dot meant.
    this.#arrived.clear();
    this.#root.hidden = true;
    this.#level = LEVEL.PAGE;
    releaseFocus(this.#window, this);
  }

  showOverview() {
    this.#level = LEVEL.OVERVIEW;
    this.#regionId = null;
    this.#focus = null;
    this.render();
  }

  /**
   * Zoom into one region: the cards of one trail.
   *
   * @param {number} regionId
   */
  showRegion(regionId) {
    this.#level = LEVEL.REGION;
    this.#regionId = regionId;
    const cards = this.model.cardsIn(regionId);
    this.#focus = cards.length ? cards[0].id : null;
    this.render();
  }

  /**
   * Enter a card: its page fills the window and becomes active.
   *
   * @param {number} cardId
   * @returns {boolean} Whether the card existed.
   */
  enterCard(cardId) {
    const card = this.model.getCard(cardId);
    return card ? this.enterNode(card.node_id) : false;
  }

  /**
   * Enter a page, whether or not it still has a card.
   *
   * A page whose card was dismissed comes back, which is §8 stated as
   * behaviour rather than as a promise: dismissal is only free if one `enter`
   * undoes it, and the mark is still on the page because the mark belongs to
   * the node rather than to the card.
   *
   * @param {number} nodeId
   * @returns {boolean} Whether the page existed.
   */
  enterNode(nodeId) {
    const node = this.#session.store.getNode(nodeId);
    if (!node) {
      return false;
    }
    if (!this.model.cardForNode(nodeId)) {
      this.model.restore(nodeId);
    }
    // Fire and forget: `enter` restores asynchronously, and the Field has
    // nothing left to do once the page is on its way.
    this.#session.enter(nodeId);
    this.close();
    return true;
  }

  /**
   * Drop a card from the Field. §8: the page stays on its trail, restorable in
   * one command with its scroll offset intact, which is the guarantee the whole
   * pillar rests on.
   *
   * @param {number} cardId
   * @returns {boolean} Whether the card existed.
   */
  dismissCard(cardId) {
    if (!this.model.getCard(cardId)) {
      return false;
    }
    const remaining = this.model
      .cardsIn(this.#regionId ?? -1)
      .filter(c => c.id !== cardId);
    this.model.dismiss(cardId);
    if (this.#focus === cardId) {
      this.#focus = remaining.length ? remaining[0].id : null;
    }
    if (this.isOpen) {
      this.render();
    }
    return true;
  }

  // ---- thumbnails ---------------------------------------------------------

  /**
   * Capture every open tab for whichever node it is showing.
   *
   * This is §7's "captured on leaving the page level", and it is the moment
   * that matters: the Field is about to be looked at, so every page that has a
   * browser behind it right now can be made current in one pass. A card whose
   * page is not open in any tab keeps the snapshot taken the last time it was,
   * which is the whole reason the cache outlives the browser element.
   */
  #captureOpenTabs() {
    for (const tab of this.#window.gBrowser?.tabs ?? []) {
      const browser = tab.linkedBrowser;
      const nodeId = this.#session.nodeForBrowser(browser);
      if (nodeId !== null) {
        this.#capture(browser, nodeId);
      }
    }
  }

  /**
   * @param {object} browser A browser element.
   * @param {number} nodeId The node it is showing.
   */
  async #capture(browser, nodeId) {
    // The document this picture is meant to be of. A departure capture is
    // fired as the *next* load starts, and there are two awaits below before
    // anything is drawn, so the browser can swap documents underneath us —
    // and `drawSnapshot` will paint whatever is in front of it by then and
    // report success. There is no error to catch: the failure is a picture of
    // the wrong page, filed under this node, over the top of a correct one.
    //
    // The inner window id is the identity that changes exactly when the
    // document does, so it is read before and checked after. A capture that
    // lost the race is dropped, and the node keeps whichever earlier snapshot
    // it had — always the better of the two outcomes, because a stale picture
    // of the right page beats a fresh picture of a different one.
    const showing = browser.browsingContext?.currentWindowGlobal?.innerWindowId;
    if (!showing) {
      return;
    }
    const geom = this.model.geometry;
    const canvas = this.#window.document.createElementNS(HTML_NS, "canvas");
    const dpr = this.#window.devicePixelRatio || 1;
    canvas.width = Math.round(geom.cardWidth * dpr * THUMBNAIL_SCALE);
    canvas.height = Math.round(geom.cardHeight * dpr * THUMBNAIL_SCALE);

    let captured = false;
    try {
      captured = await lazy.PageThumbs.captureTabPreviewThumbnail(
        browser,
        canvas
      );
    } catch (e) {
      // A browser torn down mid-capture, or a page with no window global yet.
      // Neither is worth a console entry every time a tab is opened.
      captured = false;
    }
    if (!captured) {
      return;
    }
    if (
      browser.browsingContext?.currentWindowGlobal?.innerWindowId !== showing
    ) {
      return;
    }

    // JPEG rather than PNG: these are photographs of pages, they are never
    // read pixel-exact, and the difference across a session's worth of cards
    // is megabytes.
    this.#thumbs.set(nodeId, canvas.toDataURL("image/jpeg", 0.75));
    while (this.#thumbs.size > THUMBNAIL_CACHE) {
      this.#thumbs.delete(this.#thumbs.keys().next().value);
    }
    if (this.isOpen) {
      this.#paintThumbs();
    }
    this.#store(browser);
  }

  /**
   * Put the page in Gecko's thumbnail store too, which outlives the process.
   *
   * The capture above is the card's, and it dies with the window; this is the
   * same moment written to disk so a restored card has something to show. It is
   * a second capture rather than a re-encoding of the first because the store
   * is shared — it is keyed by url, read by anything in the browser that wants
   * a picture of a page, and expects the standard thumbnail geometry, not a
   * card-shaped crop. `captureAndStoreIfStale` is what keeps that affordable:
   * every open of the Field asks about every open tab, and all but the first
   * ask in a thumbnail's lifetime costs one stat of a file.
   *
   * `shouldStoreThumbnail` is the whole guard, and is the reason to go through
   * this store rather than persist our own: it already refuses private windows,
   * about: pages, error responses and documents whose channel says not to cache
   * them. `init` is idempotent, and registers the listener that wipes stored
   * thumbnails when the user clears history — nothing else in this build calls
   * it, and writing to a store that outlives a history clear is not something
   * to ship.
   *
   * @param {object} browser The browser that was just captured.
   */
  async #store(browser) {
    try {
      if (!(await lazy.PageThumbs.shouldStoreThumbnail(browser))) {
        return;
      }
      lazy.PageThumbs.init();
      await lazy.PageThumbs.captureAndStoreIfStale(browser);
    } catch (e) {
      // Same tear-down races as the capture above, plus a disk that refused
      // the write. A card that has to fall back to its caption is not an error.
      return;
    }
    // Whatever this url's answer was before, it now has an image on disk.
    this.#stored.delete(browser.currentURI?.spec);
  }

  /**
   * Put cached snapshots into whatever cards are on screen.
   *
   * Memory first, disk second: a page visited this session has a card-shaped
   * capture taken when it was departed, which is sharper and more current than
   * anything the shared store holds.
   */
  #paintThumbs() {
    for (const el of this.#stage.querySelectorAll("[data-node-id]")) {
      const nodeId = Number(el.dataset.nodeId);
      const url = this.#thumbs.get(nodeId) ?? this.#storedFor(nodeId);
      const shot = el.querySelector(".fos-field-shot");
      if (url && shot && shot.style.backgroundImage !== `url("${url}")`) {
        shot.style.backgroundImage = `url("${url}")`;
        shot.toggleAttribute("data-empty", false);
      }
    }
  }

  /**
   * The stored thumbnail for a node's page, if one is already known to exist.
   *
   * Answers from the cache and never blocks a paint: the first ask for a url
   * starts the disk check and returns nothing, and the check repaints if it
   * found something. A url that has no thumbnail stays in the map as null so
   * the Field does not stat it again on every render.
   *
   * @param {number} nodeId
   * @returns {?string} A `moz-page-thumb://` URL, or null.
   */
  #storedFor(nodeId) {
    const url = this.#session.store.getNode(nodeId)?.url;
    if (!url) {
      return null;
    }
    if (!this.#stored.has(url)) {
      this.#stored.set(url, null);
      this.#probeStored(url);
    }
    return this.#stored.get(url);
  }

  /**
   * @param {string} url A page url.
   */
  async #probeStored(url) {
    let exists = false;
    try {
      exists = await IOUtils.exists(lazy.PageThumbs.getThumbnailPath(url));
    } catch (e) {
      exists = false;
    }
    if (!exists) {
      return;
    }
    this.#stored.set(url, lazy.PageThumbs.getThumbnailURL(url));
    if (this.isOpen) {
      this.#paintThumbs();
    }
  }

  // ---- rendering ----------------------------------------------------------

  render() {
    if (!this.#root || this.#root.hidden) {
      return;
    }
    this.#stage.textContent = "";
    if (this.#level === LEVEL.REGION) {
      this.#renderRegion();
    } else {
      this.#renderOverview();
    }
    this.#paintThumbs();
  }

  get #viewport() {
    return {
      width: this.#stage.clientWidth || this.#window.innerWidth,
      height: this.#stage.clientHeight || this.#window.innerHeight,
    };
  }

  #renderOverview() {
    const doc = this.#window.document;
    const model = this.model;
    const slots = model.overview();
    const occupied = slots.filter(entry => entry.kind !== "empty");

    this.#crumbs.textContent = "The Field";
    this.#status.textContent = occupied.length
      ? `${occupied.length} trails, ${model.cards().length} cards`
      : "";

    if (!occupied.length) {
      const empty = doc.createElementNS(HTML_NS, "p");
      empty.className = "fos-field-empty";
      empty.textContent =
        "Nothing in play. Every page you open takes a place here.";
      this.#stage.appendChild(empty);
      this.#layout = null;
      return;
    }

    const layout = overviewLayout({
      slots,
      viewport: this.#viewport,
      geometry: model.geometry,
    });
    this.#layout = layout;

    if (this.#focus === null) {
      this.#focus = occupied[0].region?.id ?? null;
    }

    for (const tile of layout.tiles) {
      this.#stage.appendChild(this.#buildTile(tile));
    }
    this.#applyFocus();
  }

  /**
   * One overview tile: a region, drawn as a faithful miniature of itself.
   *
   * Faithful matters. §3 makes zoom a semantic operation, but the *transition*
   * has to read as one shape growing into another, or the user loses track of
   * where the page they just entered sits relative to everything else. So a
   * tile is the region at `layout.scale` and nothing else — no separate
   * "summary" arrangement that would have to be learned twice.
   *
   * @param {object} tile A tile from `overviewLayout`.
   * @returns {Element}
   */
  #buildTile(tile) {
    const doc = this.#window.document;
    const model = this.model;
    const nested = tile.kind === "nest";
    const regions = nested ? tile.regions : [tile.region];

    const el = doc.createElementNS(HTML_NS, "section");
    el.className = "fos-field-tile";
    el.id = `fos-field-tile-${nested ? "nest" : tile.region.id}`;
    el.dataset.regionId = nested ? "nest" : String(tile.region.id);
    el.setAttribute("role", "group");
    // A miniature is about ten pixels across at the overview scale, so the
    // accent on one is not readable as an answer to "where did it go" — the
    // tile has to carry it too. Two levels, one question: which trail, then
    // which card.
    el.toggleAttribute(
      "data-arrived",
      regions.some(region =>
        model.cardsIn(region.id).some(card => this.#arrived.has(card.node_id))
      )
    );
    el.style.left = `${tile.x}px`;
    el.style.top = `${tile.y}px`;
    el.style.width = `${tile.width}px`;
    el.style.height = `${tile.height}px`;

    const head = doc.createElementNS(HTML_NS, "header");
    head.className = "fos-field-tile-head";

    const name = doc.createElementNS(HTML_NS, "span");
    name.className = "fos-field-tile-name";
    name.textContent = nested
      ? `${regions.length} more trails`
      : (this.#session.store.getTrail(tile.region.id)?.name ?? "Unnamed trail");

    const count = doc.createElementNS(HTML_NS, "span");
    count.className = "fos-field-tile-count";
    count.textContent = String(
      regions.reduce((n, r) => n + model.cardsIn(r.id).length, 0)
    );

    head.append(name, count);

    const body = doc.createElementNS(HTML_NS, "div");
    body.className = "fos-field-tile-body";

    // The nest holds several regions in one tile, so its miniatures are packed
    // side by side rather than overlaid — otherwise two trails' cards would
    // read as one trail's arrangement, which is exactly the provenance claim
    // being false on screen.
    const share = 1 / Math.max(regions.length, 1);
    regions.forEach((region, index) => {
      // Each region gets a wrapper carrying its own translate and scale, and
      // its miniatures are placed inside it in unscaled field units. The scale
      // then lives in one declaration per region instead of four per card,
      // which is what a resize has to rewrite — see `miniTransform`.
      const nest = doc.createElementNS(HTML_NS, "div");
      nest.className = "fos-field-mininest";
      nest.dataset.regionId = String(region.id);
      nest.style.transform = miniTransform(
        index * tile.width * share,
        miniScale(region, tile, nested ? share : 1)
      );

      for (const card of model.cardsIn(region.id)) {
        const mini = doc.createElementNS(HTML_NS, "div");
        mini.className = "fos-field-mini";
        mini.dataset.nodeId = String(card.node_id);
        mini.toggleAttribute("data-arrived", this.#arrived.has(card.node_id));
        mini.style.left = `${card.x}px`;
        mini.style.top = `${card.y}px`;
        mini.style.width = `${model.geometry.cardWidth}px`;
        mini.style.height = `${model.geometry.cardHeight}px`;

        const shot = doc.createElementNS(HTML_NS, "div");
        shot.className = "fos-field-shot";
        shot.toggleAttribute("data-empty", true);
        mini.appendChild(shot);
        nest.appendChild(mini);
      }
      body.appendChild(nest);
    });

    el.append(head, body);
    el.addEventListener("mousedown", event => {
      event.preventDefault();
      if (nested) {
        // Entering the nest promotes its least stale region back to a tile of
        // its own rather than opening a fourth level. Three levels is the
        // whole of §3, and a nest of nests is how a bounded design becomes an
        // unbounded one by accident.
        this.showRegion(regions[0].id);
      } else {
        this.showRegion(tile.region.id);
      }
    });
    return el;
  }

  #renderRegion() {
    const doc = this.#window.document;
    const model = this.model;
    const region = model.regions().find(r => r.id === this.#regionId);
    if (!region) {
      this.showOverview();
      return;
    }
    const cards = model.cardsIn(region.id);
    const trail = this.#session.store.getTrail(region.id);

    this.#crumbs.textContent = trail?.name ?? "Unnamed trail";
    this.#status.textContent = `${cards.length} cards`;

    const layout = regionLayout({
      region,
      cards,
      viewport: this.#viewport,
      geometry: model.geometry,
    });
    this.#layout = layout;

    const frame = doc.createElementNS(HTML_NS, "div");
    frame.className = "fos-field-region";
    frame.style.left = `${layout.originX}px`;
    frame.style.top = `${layout.originY}px`;
    frame.style.width = `${layout.width}px`;
    frame.style.height = `${layout.height}px`;
    this.#stage.appendChild(frame);

    const focused = model.getCard(this.#focus);
    const lineage = lineageCards(
      this.#session.store,
      focused?.node_id ?? null,
      cards
    );

    // Lineage reads as "these, and not those", so the stage has to know a chain
    // is lit: an outline colour alone was not tellable from the focus ring in a
    // screenshot, and a highlight nobody can see is not a highlight.
    this.#stage.toggleAttribute("data-lineage-active", lineage.size > 0);
    for (const card of layout.cards) {
      this.#stage.appendChild(this.#buildCard(card, lineage));
    }
    this.#applyFocus();
  }

  /**
   * One card: a thumbnail, a title bound to it, and its mark.
   *
   * All three are §7, and each of the three is a correction Data Mountain made
   * after watching people fail with the version that lacked it. The title is
   * rendered rather than put in a tooltip because a hover delay "precluded
   * rapid inspection of multiple titles", and it sits inside the card's own box
   * because a floating title users could not attribute to a thumbnail had to be
   * tied to it before it helped.
   *
   * @param {object} card A card from `regionLayout`.
   * @param {Set<number>} lineage Card ids on the focused card's ancestor chain.
   * @returns {Element}
   */
  #buildCard(card, lineage) {
    const doc = this.#window.document;
    const node = this.#session.store.getNode(card.node_id);

    const el = doc.createElementNS(HTML_NS, "div");
    el.className = "fos-field-card";
    el.id = `fos-field-card-${card.id}`;
    el.dataset.cardId = String(card.id);
    el.dataset.nodeId = String(card.node_id);
    el.setAttribute("role", "option");
    el.toggleAttribute("data-pinned", card.pinned);
    el.toggleAttribute("data-lineage", lineage.has(card.id));
    el.toggleAttribute("data-arrived", this.#arrived.has(card.node_id));
    el.style.left = `${card.left}px`;
    el.style.top = `${card.top}px`;
    el.style.width = `${card.width}px`;
    // Exactly the model's box: see `VIEW_METRICS.cardCaption`. The card is
    // what the non-occlusion invariant is about, so what is drawn has to be
    // the same rectangle the invariant was checked against.
    el.style.height = `${card.height}px`;

    const caption = Math.min(VIEW_METRICS.cardCaption, card.height / 2);
    const shot = doc.createElementNS(HTML_NS, "div");
    shot.className = "fos-field-shot";
    shot.style.height = `${card.height - caption}px`;
    shot.toggleAttribute("data-empty", true);

    const mark = doc.createElementNS(HTML_NS, "span");
    mark.className = "fos-field-mark";
    // The page's mark, not the card's: one object, one letter, shown wherever
    // that object appears.
    mark.textContent = this.#markFor(card.node_id) ?? "";

    const title = doc.createElementNS(HTML_NS, "span");
    title.className = "fos-field-caption";
    title.style.height = `${caption}px`;
    title.textContent = cardCaption(node);

    el.setAttribute("aria-label", `${title.textContent}. ${node?.url ?? ""}`);
    el.append(shot, mark, title);
    return el;
  }

  /**
   * Re-render at most once per frame.
   *
   * Deliberately a frame rather than a timeout: the work exists to put a
   * correct picture on the next frame, so the refresh driver is the thing that
   * knows when it is needed. A trailing timeout would also leave the last
   * render firing after the gesture ended.
   */
  #onResize() {
    if (this.#resizeFrame) {
      return;
    }
    this.#resizeFrame = this.#window.requestAnimationFrame(() => {
      this.#resizeFrame = 0;
      this.#resizePasses++;
      if (!this.#repositionOverview()) {
        this.render();
      }
    });
  }

  #applyFocus() {
    const active = this.#stage.querySelector(
      this.#level === LEVEL.REGION
        ? `.fos-field-card[data-card-id="${this.#focus}"]`
        : `.fos-field-tile[data-region-id="${this.#focus}"]`
    );
    for (const el of this.#stage.querySelectorAll(
      ".fos-field-card, .fos-field-tile"
    )) {
      el.toggleAttribute("data-focus", el === active);
    }
    if (active) {
      this.#stage.setAttribute("aria-activedescendant", active.id);
    } else {
      this.#stage.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * Reposition the cards already on screen from the model, without rebuilding
   * them. This is what a drag runs on: rebuilding the DOM per pointer move
   * would drop the pointer capture and make the non-occlusion push (§6) look
   * like a flicker instead of a shove.
   */
  #applyPositions() {
    const model = this.model;
    const region = model.regions().find(r => r.id === this.#regionId);
    if (!region) {
      return;
    }
    const layout = regionLayout({
      region,
      cards: model.cardsIn(region.id),
      viewport: this.#viewport,
      geometry: model.geometry,
    });
    this.#layout = layout;
    for (const card of layout.cards) {
      const el = this.#stage.querySelector(
        `.fos-field-card[data-card-id="${card.id}"]`
      );
      if (el) {
        el.style.left = `${card.left}px`;
        el.style.top = `${card.top}px`;
        el.toggleAttribute("data-pinned", card.pinned);
      }
    }
  }

  /**
   * Draw the overview at a new scale without rebuilding it.
   *
   * The resize comment above `addEventListener` says what a resize means here:
   * nothing moves, the same arrangement is drawn at a different size. `render`
   * does not know that. It empties the stage and builds every tile and every
   * miniature again, which on the worst case the design permits — twelve
   * trails, 480 cards — is 9.9ms of script and 7.7ms of layout, and does not
   * fit in a frame however few times per frame it runs. This path leaves the
   * tree alone, so the cost is none of the construction; and because a
   * miniature is placed in field units under a wrapper that carries its
   * region's scale, what it writes is four declarations per tile and one per
   * region — a dozen or so, rather than one per card.
   *
   * It is the overview's alone. The region level rebuilds on a resize as it
   * did: its cards carry captions and marks whose size does not follow the
   * scale, so a reposition there is not the same four declarations, and one
   * region is a fraction of the crowded overview's cost anyway.
   *
   * Every reason to refuse is a difference between what is on screen and what
   * the model now says, and the answer to all of them is the full rebuild the
   * caller falls back to. That includes a card the model has gained or lost:
   * this path may not invent an element, and a stale miniature left at a new
   * scale would be a card claiming a place no card holds.
   *
   * @returns {boolean} True if the overview now shows the new size.
   */
  #repositionOverview() {
    if (this.#level !== LEVEL.OVERVIEW || !this.#layout) {
      return false;
    }
    const model = this.model;
    const layout = overviewLayout({
      slots: model.overview(),
      viewport: this.#viewport,
      geometry: model.geometry,
    });
    const tileEls = this.#stage.querySelectorAll(".fos-field-tile");
    if (tileEls.length !== layout.tiles.length) {
      return false;
    }

    // Every write is collected before any is applied. A refusal found halfway
    // through would otherwise leave half the overview at the old scale and
    // half at the new one, and the rebuild that follows would be repairing a
    // surface this path had broken rather than one it declined to touch.
    const boxes = [];
    const transforms = [];
    for (const [index, tile] of layout.tiles.entries()) {
      const el = tileEls[index];
      const nested = tile.kind === "nest";
      if (el.dataset.regionId !== (nested ? "nest" : String(tile.region.id))) {
        return false;
      }
      boxes.push([el, tile.x, tile.y, tile.width, tile.height]);

      const regions = nested ? tile.regions : [tile.region];
      const share = 1 / Math.max(regions.length, 1);
      const nests = el.querySelectorAll(".fos-field-mininest");
      if (nests.length !== regions.length) {
        return false;
      }
      for (const [slot, region] of regions.entries()) {
        const nest = nests[slot];
        if (nest.dataset.regionId !== String(region.id)) {
          return false;
        }
        // The miniatures are not written at all: they are in field units, and
        // a resize does not move a card. So what was a write per card is now a
        // read per card, checking the one thing that makes leaving them alone
        // correct — that the arrangement on screen is still the model's. A
        // card the model has moved, gained or lost is a difference this path
        // cannot express, and the answer to all three is the rebuild.
        const cards = model.cardsIn(region.id);
        const minis = nest.children;
        if (minis.length !== cards.length) {
          return false;
        }
        for (const [i, card] of cards.entries()) {
          const mini = minis[i];
          if (
            mini.dataset.nodeId !== String(card.node_id) ||
            mini.style.left !== `${card.x}px` ||
            mini.style.top !== `${card.y}px`
          ) {
            return false;
          }
        }
        transforms.push([
          nest,
          miniTransform(
            slot * tile.width * share,
            miniScale(region, tile, nested ? share : 1)
          ),
        ]);
      }
    }

    for (const [el, x, y, width, height] of boxes) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }
    for (const [el, transform] of transforms) {
      el.style.transform = transform;
    }
    this.#layout = layout;
    return true;
  }

  // ---- input --------------------------------------------------------------

  #onPointerDown(event) {
    if (this.#level !== LEVEL.REGION || event.button !== 0) {
      return;
    }
    const cardId = cardIdFromEvent(event);
    if (cardId === null) {
      return;
    }
    event.preventDefault();
    const card = this.model.getCard(cardId);
    const layout = this.#layout;
    if (!card || !layout) {
      return;
    }
    this.#focus = cardId;
    this.#applyFocus();

    const bounds = this.#stage.getBoundingClientRect();
    this.#drag = {
      cardId,
      moved: false,
      grab: {
        x:
          (event.clientX - bounds.left - layout.originX) / layout.scale -
          card.x,
        y:
          (event.clientY - bounds.top - layout.originY) / layout.scale - card.y,
      },
    };
    this.#stage.setPointerCapture(event.pointerId);
  }

  #onPointerMove(event) {
    if (!this.#drag) {
      return;
    }
    const model = this.model;
    const region = model.regions().find(r => r.id === this.#regionId);
    const bounds = this.#stage.getBoundingClientRect();
    const point = pointerToField({
      clientX: event.clientX - bounds.left,
      clientY: event.clientY - bounds.top,
      grab: this.#drag.grab,
      layout: this.#layout,
      region,
      geometry: model.geometry,
    });

    // Every pointer move commits. §6: what the user sees mid-drag is exactly
    // the state that results when they let go, which is what removes the
    // settle animation and with it the class of bug where a card ends up
    // somewhere the user did not aim.
    const outcome = model.moveCard(this.#drag.cardId, point.x, point.y);
    const el = this.#stage.querySelector(
      `.fos-field-card[data-card-id="${this.#drag.cardId}"]`
    );
    el?.toggleAttribute("data-refused", !outcome.ok);
    if (outcome.ok) {
      this.#drag.moved = true;
      this.#applyPositions();
    } else {
      // Refusing is the design (§6): the alternative is silently destroying a
      // position the user chose. Say which of the two reasons it was, because
      // a drop that just stops with no explanation reads as a bug.
      this.#status.textContent =
        outcome.reason === "would-displace-pinned"
          ? "Blocked by a card you placed"
          : "Not room there";
    }
  }

  #onPointerUp(event) {
    if (!this.#drag) {
      return;
    }
    const el = this.#stage.querySelector(
      `.fos-field-card[data-card-id="${this.#drag.cardId}"]`
    );
    el?.toggleAttribute("data-refused", false);
    const { cardId, moved } = this.#drag;
    this.#drag = null;
    this.#stage.releasePointerCapture?.(event.pointerId);
    if (!moved) {
      // A press that never moved is a click, and a click on a card enters it.
      this.enterCard(cardId);
      return;
    }
    // The drop, not the drag. Every pointer move commits to the model, but a
    // placement is one thing the user did and is worth one row — persisting
    // per pointer move would write a hundred rows for one gesture and record
    // every position the card passed through as though it had been chosen.
    //
    // Only the dragged card is announced. The push may have moved others, and
    // none of them is a position anybody chose: they are unpinned, so §4 leaves
    // the system free to revise them and the next start re-seeds them.
    const card = this.model.cards().find(c => c.id === cardId);
    if (card) {
      this.#emitPlacement({ nodeId: card.node_id, x: card.x, y: card.y });
    }
    this.render();
  }

  #onKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        // Escape zooms out one level and only leaves the Field from the
        // overview, so it is always "back to the wider view" and never
        // ambiguous about whether it will close something.
        if (this.#level === LEVEL.REGION) {
          this.showOverview();
        } else {
          this.close();
        }
        break;

      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        event.preventDefault();
        const direction = event.key.replace("Arrow", "").toLowerCase();
        const items =
          this.#level === LEVEL.REGION
            ? (this.#layout?.cards ?? []).map(card => ({
                id: card.id,
                x: card.left,
                y: card.top,
                width: card.width,
                height: card.height,
              }))
            : (this.#layout?.tiles ?? [])
                .filter(tile => tile.kind !== "empty")
                .map(tile => ({
                  id: tile.kind === "nest" ? "nest" : tile.region.id,
                  x: tile.x,
                  y: tile.y,
                  width: tile.width,
                  height: tile.height,
                }));
        this.#focus = moveFocus(items, this.#focus, direction);
        if (this.#level === LEVEL.REGION) {
          this.render();
        } else {
          this.#applyFocus();
        }
        break;
      }

      case "Enter": {
        event.preventDefault();
        if (this.#focus === null) {
          break;
        }
        if (this.#level === LEVEL.REGION) {
          this.enterCard(this.#focus);
        } else if (this.#focus === "nest") {
          const nest = this.model
            .overview()
            .find(entry => entry.kind === "nest");
          if (nest?.regions.length) {
            this.showRegion(nest.regions[0].id);
          }
        } else {
          this.showRegion(this.#focus);
        }
        break;
      }
    }
  }

  // ---- DOM ----------------------------------------------------------------

  #build() {
    if (this.#root) {
      return;
    }
    const doc = this.#window.document;

    ensureStylesheet(this.#window, STYLESHEET);

    const root = doc.createElementNS(HTML_NS, "div");
    root.className = "fos-field";
    root.hidden = true;

    const bar = doc.createElementNS(HTML_NS, "header");
    bar.className = "fos-field-bar";

    const crumbs = doc.createElementNS(HTML_NS, "span");
    crumbs.className = "fos-field-crumbs";

    const status = doc.createElementNS(HTML_NS, "span");
    status.className = "fos-field-status";
    status.setAttribute("role", "status");

    bar.append(crumbs, status);

    const stage = doc.createElementNS(HTML_NS, "div");
    stage.className = "fos-field-stage";
    stage.setAttribute("role", "listbox");
    stage.setAttribute("aria-label", "The Field");
    stage.setAttribute("tabindex", "0");

    stage.addEventListener("keydown", event => this.#onKeyDown(event));
    stage.addEventListener("pointerdown", event => this.#onPointerDown(event));
    stage.addEventListener("pointermove", event => this.#onPointerMove(event));
    stage.addEventListener("pointerup", event => this.#onPointerUp(event));

    root.append(bar, stage);
    doc.documentElement.appendChild(root);

    // The overview is the whole world scaled to fit (§2), so a resize is a
    // re-layout rather than a scroll. Positions are stored in field units for
    // exactly this reason: nothing moves, the same arrangement is drawn at a
    // different scale, which is acceptance property 2 under a resize.
    //
    // Coalesced to one render per frame, because `render` rebuilds the stage
    // from nothing and a resize gesture fires this event far faster than a
    // frame. Measured on a crowded overview — twelve trails, 480 cards, 480
    // miniatures — a rebuild is ~15ms and ten events arriving in one tick cost
    // ~53ms of them, which took the frame interval during a window drag from
    // 17ms to a p95 of 65ms against 23ms with the Field closed. Nothing about
    // the rebuild itself needed to get faster: what was wrong was doing it more
    // than once for one frame. See `tests/browser/browser_zzfieldperf.js`.
    this.#window.addEventListener("resize", () => this.#onResize());

    this.#root = root;
    this.#stage = stage;
    this.#crumbs = crumbs;
    this.#status = status;
  }
}
