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
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
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
 * Binds the action table's verbs to handlers for one chrome window.
 *
 * Every handler is `(command, window) => any`, receiving the parsed command
 * object exactly as the parser produced it: `{action, target, text}`, where
 * `target` is a mark letter or null.
 */
export class FOSActionDispatcher {
  #window;
  #handlers = new Map();

  constructor(window) {
    this.#window = window;
    this.register("search", cmd => this.openQuery(cmd.text));
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
    const resolved = resolveInput(text, {
      isPrivate: lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window),
    });
    if (!resolved) {
      return null;
    }

    // The system principal is what the address bar uses for a URL the user
    // typed, and for the same reason: the load has no web-content initiator, so
    // there is no other principal that honestly describes who asked for it.
    this.#window.gBrowser.selectedBrowser.loadURI(resolved.uri, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      postData: resolved.postData,
    });
    return resolved;
  }
}
