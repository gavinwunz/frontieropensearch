/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The execution half of the one parse path.
 *
 *   keystrokes ─┐
 *               ├─→ token stream ─→ parse ─→ command object ─→ execute
 *   transcript ─┘                                              ^^^^^^^
 *
 * `design/GRAMMAR.md` §5 requires that everything downstream of the token
 * stream be shared and have no knowledge of which modality produced its input.
 * This module is downstream, so it takes command objects and nothing else — it
 * has no reference to the input element, to keystrokes, or to a transcript.
 *
 * Two things live here:
 *
 *   1. `resolveInput` — whether a query is a URL to open or text to search.
 *   2. `FOSActionDispatcher` — the action table's verbs bound to handlers.
 *
 * Handlers are registered rather than hardcoded because the verbs belong to the
 * three pillars and the pillars land in separate runs. An unregistered verb is
 * reported as such; it never fails silently and never falls back to search,
 * which would be `GRAMMAR.md` §3's forbidden case of a query silently hijacking
 * a command the user plainly meant.
 */

import { ACTIONS, actionSpec } from "./FOSGrammar.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

/**
 * What `resolveInput` decided the text was. Prefixed because bare `URL` and
 * `SEARCH` would shadow DOM globals at every call site in chrome.
 */
export const KIND_URL = "url";
export const KIND_SEARCH = "search";

/** A verb the grammar defines but no pillar has registered a handler for yet. */
export const NOT_WIRED = "not-wired";

/**
 * Decide whether a line of prose is a URL to open or text to search for.
 *
 * `GRAMMAR.md` §3 settles what is a command and what is a query, and stops
 * there — a query is prose, and prose covers both `gecko session history` and
 * `example.org/docs`. Splitting those two is not a grammar question, because
 * the answer depends on what hostnames and schemes exist rather than on how the
 * line is shaped, so it is settled here at execution instead.
 *
 * Gecko already owns this decision and has for two decades: `nsIURIFixup` is
 * what the address bar uses, it knows the scheme typos, the alternate-URI prefs
 * and the keyword-search fallback, and it returns which of the two it chose. So
 * this is a thin wrapper on the shipped answer rather than a new heuristic —
 * a hand-rolled "does it look like a URL" check is exactly the kind of thing
 * that gets `localhost:8080` and `pack rat` wrong in opposite directions.
 *
 * @param {string} text The query text.
 * @param {object} [options]
 * @param {boolean} [options.isPrivate] Suppresses keyword lookup logging.
 * @returns {?object} `{kind, uri, postData, display}`, or null when the text is
 *   empty or nothing at all could be salvaged from it.
 */
export function resolveInput(text, { isPrivate = false } = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }

  let flags =
    Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP |
    Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS;
  if (isPrivate) {
    flags |= Ci.nsIURIFixup.FIXUP_FLAG_PRIVATE_CONTEXT;
  }

  let info;
  try {
    info = Services.uriFixup.getFixupURIInfo(trimmed, flags);
  } catch (e) {
    // Fixup throws on input it cannot make anything of at all. That is a
    // legitimate outcome for a command bar that accepts arbitrary prose, not
    // an error worth propagating.
    return null;
  }

  if (!info.preferredURI) {
    return null;
  }

  // A non-empty `keywordAsSent` is fixup's own report that it fell back to a
  // keyword search rather than recognising a URL. Reading its answer is what
  // keeps this in step with the address bar instead of drifting from it.
  const searched = !!info.keywordAsSent;

  return {
    kind: searched ? KIND_SEARCH : KIND_URL,
    uri: info.preferredURI,
    postData: info.postData,
    display: searched ? info.keywordAsSent : info.preferredURI.displaySpec,
  };
}

/**
 * The engine `resolveInput`'s keyword fallback would have used.
 *
 * Fixup does not report which engine answered — it returns the submission URL
 * and nothing else — so this reads the same two properties `URIFixup.keywordToURI`
 * reads, in the same order, guarded the same way. It is a name for Places to
 * record against the visit, not a second decision about which engine to use:
 * if this ever disagreed with fixup, the visit would be filed under the wrong
 * engine rather than sent to it.
 *
 * @param {boolean} isPrivate Whether the window is private.
 * @returns {?string} The engine's name, or null if search is not up.
 */
function keywordEngineName(isPrivate) {
  if (!lazy.SearchService.hasSuccessfullyInitialized) {
    return null;
  }
  const engine = isPrivate
    ? lazy.SearchService.defaultPrivateEngine
    : lazy.SearchService.defaultEngine;
  return engine?.name ?? null;
}

/**
 * Binds the action table's verbs to handlers for one chrome window.
 *
 * Every handler is `(command, window) => any`, receiving the parsed command
 * object exactly as the parser produced it: `{action, target, text}`, where
 * `target` is a mark letter or null.
 */
export class FOSActionDispatcher {
  #window;
  #handlers = new Map();
  #queryListeners = new Set();
  #loads = 0;

  constructor(window) {
    this.#window = window;
    this.register("search", cmd => this.openQuery(cmd.text));
  }

  /**
   * Be told about every query the user issues.
   *
   * `openQuery` is the single funnel for both ways a query can arrive — bare
   * prose that the parser classified as a query, and the explicit `search`
   * verb — so one hook here catches all of them. The Context Engine is the
   * subscriber, and it listens rather than being called because a query is not
   * an action it performs: recording is a side effect of browsing, and the
   * dispatcher must not acquire a dependency on a pillar to run.
   *
   * @param {Function} listener Called as `(text, resolved)` after the load has
   *   been asked for, where `resolved` is what `resolveInput` decided.
   * @returns {Function} An unsubscribe function.
   */
  onQuery(listener) {
    this.#queryListeners.add(listener);
    return () => this.#queryListeners.delete(listener);
  }

  /**
   * How many page loads this dispatcher has asked for.
   *
   * Only ever compared with itself, across a line the command bar just ran, to
   * answer one question: did that line put a new page in front of the user?
   * The bar needs it to decide where the keyboard goes when it closes —
   * `field` leaves the user on a surface, `wikipedia` leaves them on a page,
   * and the difference is not visible in the verbs because a search reaches
   * the dispatcher as bare prose. Every load goes through one funnel, so
   * counting there is the whole of it.
   *
   * @returns {number}
   */
  get loads() {
    return this.#loads;
  }

  /**
   * Bind a verb. Pillars call this as they land.
   *
   * @param {string} action An action word from the table.
   * @param {Function} handler Called as `(command, window)`.
   */
  register(action, handler) {
    if (!actionSpec(action)) {
      throw new Error(`FOSActions: ${action} is not in the action table`);
    }
    this.#handlers.set(action, handler);
  }

  /**
   * Whether a verb has a handler yet.
   *
   * @param {string} action An action word from the table.
   * @returns {boolean}
   */
  has(action) {
    return this.#handlers.has(action);
  }

  /** The verbs the grammar defines but nothing has claimed. */
  unwired() {
    return Object.keys(ACTIONS).filter(word => !this.has(word));
  }

  /**
   * Run one parsed command.
   *
   * @param {object} command A `{action, target, text}` object from the parser.
   * @returns {object} `{ok, action, result}` or `{ok: false, reason: NOT_WIRED}`.
   */
  run(command) {
    const handler = this.#handlers.get(command.action);
    if (!handler) {
      return { ok: false, action: command.action, reason: NOT_WIRED };
    }
    return {
      ok: true,
      action: command.action,
      result: handler(command, this.#window),
    };
  }

  /**
   * Run a whole parse's worth of commands, in order.
   *
   * Chaining is a grammar feature (`GRAMMAR.md` §3), so execution has to honour
   * it. A command with no handler stops the chain rather than being skipped: a
   * later verb in the same utterance will very often depend on what an earlier
   * one did — `enter cap branch` branches from the card `enter` just made
   * active — so continuing past a no-op would apply the rest to the wrong
   * object.
   *
   * @param {object[]} commands A parse result's commands, in order.
   * @returns {object[]} One outcome per command run.
   */
  runAll(commands) {
    const ran = [];
    for (const command of commands) {
      const outcome = this.run(command);
      ran.push(outcome);
      if (!outcome.ok) {
        break;
      }
    }
    return ran;
  }

  /**
   * Open a query: navigate if it is a URL, search if it is not.
   *
   * @param {string} text
   * @returns {?object} The resolution, so callers can report what happened.
   */
  openQuery(text) {
    const isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window);
    const resolved = resolveInput(text, { isPrivate });
    if (!resolved) {
      return null;
    }

    this.#load(resolved.uri, resolved.postData, {
      searchEngine:
        resolved.kind === KIND_SEARCH ? keywordEngineName(isPrivate) : null,
    });

    for (const listener of this.#queryListeners) {
      try {
        listener(text, resolved);
      } catch (e) {
        // A recorder that throws must not stop the navigation it is recording.
        console.error(e);
      }
    }

    return resolved;
  }

  /**
   * Open a page that is already known to be a page.
   *
   * Separate from `openQuery` because the two are different statements about
   * what the user did. A query is prose that had to be *resolved* into a URL
   * or a search, and every one of them is recorded as a query. This is a page
   * picked off a list — a suggestion, a row, a card — where the URL was never
   * in question and nobody typed it. Putting one through the other would write
   * URLs into the query log as though they had been searched for.
   *
   * @param {string|nsIURI} url The page to open.
   * @returns {boolean} Whether the load was asked for.
   */
  openURL(url) {
    let uri = url;
    if (typeof uri === "string") {
      try {
        uri = Services.io.newURI(uri);
      } catch (e) {
        console.error(e);
        return false;
      }
    }
    this.#load(uri, null);
    return true;
  }

  /**
   * The one place a load is actually asked for.
   *
   * The system principal is what the address bar uses for a URL the user
   * typed, and for the same reason: the load has no web-content initiator, so
   * there is no other principal that honestly describes who asked for it.
   *
   * The same argument settles how Places records the visit. Every load reaching
   * here was asked for by the chrome — a line typed or spoken, or a row picked
   * off a list — and none of them was a link on a page. That is the distinction
   * `TRANSITION_TYPED` exists to draw, and `markPageAsTyped` is how a surface
   * declares it; a surface that does not call it gets `TRANSITION_LINK`, which
   * would be a false statement about how the user got there. Firefox declares
   * it from the address bar, the history menu and the history sidebar, and this
   * dispatcher is the one surface that replaced all three.
   *
   * It is also not merely a label. The frecency SQL scores a typed visit a tier
   * above a link visit, and `FOSPlacesFloor` ranks the command bar's last tier
   * by exactly that score — so getting this wrong would have the fork demote
   * the pages its user asked for by name and then read the demotion back into
   * its own suggestions.
   *
   * @param {nsIURI} uri
   * @param {?nsIInputStream} postData
   * @param {object} [options]
   * @param {?string} [options.searchEngine] The engine whose result page this
   *   is, when the line resolved to a search rather than to a URL.
   */
  #load(uri, postData, { searchEngine = null } = {}) {
    this.#loads++;
    this.#markAsTyped(uri);
    this.#window.gBrowser.selectedBrowser.loadURI(uri, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      postData,
      // Read back off the browser element by `History.cpp` when the visit is
      // written, and the reason a result page can be marked typed without
      // being over-ranked: the frecency SQL withholds the typed weight from a
      // visit whose source is a search. Passing nothing clears any attribute
      // an earlier search left on this browser, which is what makes the next
      // ordinary load ordinary again.
      globalHistoryOptions: searchEngine
        ? { triggeringSearchEngine: searchEngine }
        : undefined,
    });
  }

  /**
   * Tell Places the coming visit was asked for by name.
   *
   * A hint rather than a write: it records the URL in an in-memory recent-typed
   * set that the visit, if it happens, reads on its way to the database. So a
   * load that never lands costs nothing but an entry that expires.
   *
   * That is also why a private window has to be excluded rather than left to
   * the docshell. The docshell already declines to record a private visit, but
   * the hint is not private state — it is one global set keyed by URL spec,
   * with a fifteen-minute life. Marking from a private window and then opening
   * the same page in an ordinary one inside the window would file that
   * ordinary visit as typed on the strength of the private one, which is the
   * profile database learning something from private browsing.
   *
   * @param {nsIURI} uri
   */
  #markAsTyped(uri) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)) {
      return;
    }
    try {
      lazy.PlacesUtils.history.markPageAsTyped(uri);
    } catch (e) {
      // History disabled, or a scheme Places refuses. Neither is a reason to
      // hold up the navigation.
      console.error(e);
    }
  }
}
