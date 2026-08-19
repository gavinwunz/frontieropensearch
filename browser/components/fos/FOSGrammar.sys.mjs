/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The action table: the single source of both modalities.
 *
 * `design/GRAMMAR.md` §5 requires that no action exist which only one input
 * modality can reach. That is enforced here by construction rather than by
 * discipline — an action has exactly one word, and that word is what the user
 * types and what the user says. There is no separate voice vocabulary to fall
 * out of sync.
 *
 * Fields:
 *   pillar  — which pillar the verb belongs to, for grouping in the bar's help.
 *   target  — "none" | "optional" | "required": whether a mark may follow.
 *   accepts — the object types the verb can apply to. This is what narrows the
 *             candidate marks once the action is known, which gives the
 *             keyboard user a live-narrowing list from the same filter the
 *             voice grammar uses.
 *   text    — whether a free-text argument follows, and it is always terminal
 *             (see PARSE NOTE below).
 *
 * PARSE NOTE — free text is terminal. An action taking free text consumes the
 * rest of the utterance and cannot be chained after. Talon's answer to "where
 * does dictated text end" is a 0.3s silence timeout, which its users report
 * misfiring when they pause mid-phrase; and a timeout has no meaning at all for
 * typed input, so it would give us two different grammars for the two
 * modalities — exactly what §5 forbids. A syntactic rule is identical in both.
 * The cost is that at most one free-text command may appear per utterance and
 * it must come last.
 */
export const ACTIONS = Object.freeze({
  // Pillar A — the Field.
  // `enter` and `dismiss` take a node, not a separate "card" kind. A page is
  // one object: the card is its presence on the Field and the row is its
  // presence on the rail, and giving each of those its own letter spent two of
  // the twenty-six on one page. `enter` therefore reaches a page whose card has
  // been dismissed too, which is exactly what FIELD.md §8 promises — dismissal
  // is free because one `enter` brings it back.
  enter: {
    pillar: "field",
    target: "required",
    accepts: ["node"],
    text: false,
    summary: "Zoom the card to fill the window and make it active",
  },
  field: {
    pillar: "field",
    target: "none",
    accepts: [],
    text: false,
    summary: "Return to the overview",
  },
  dismiss: {
    pillar: "field",
    target: "required",
    accepts: ["node"],
    text: false,
    summary: "Drop the card from the Field, leaving the page on its trail",
  },

  // Pillar B — trails.
  branch: {
    pillar: "trails",
    target: "none",
    accepts: [],
    text: false,
    summary: "Start a sibling from the current node",
  },
  up: {
    pillar: "trails",
    target: "none",
    accepts: [],
    text: false,
    summary: "Move to the parent node",
  },
  back: {
    pillar: "trails",
    target: "optional",
    accepts: ["node"],
    text: false,
    summary: "Move to a node without destroying any forward branch",
  },
  // No target, and the omission is the decision rather than an oversight. In
  // the tree the forward direction is plural, which is why `Browser:Forward`
  // sat in the keyset manifest's debt list for three runs; in time it is not,
  // and back and forward are both temporal here because `up` already owns the
  // structural move. Naming a node to go forward to is `back <mark>`, which
  // reaches any node in the trail and is not restricted to the ones ahead.
  forward: {
    pillar: "trails",
    target: "none",
    accepts: [],
    text: false,
    summary: "Return along the walk `back` just took",
  },
  graft: {
    pillar: "trails",
    target: "required",
    accepts: ["node"],
    text: false,
    summary: "Reattach a node elsewhere in the tree",
  },
  name: {
    pillar: "trails",
    target: "optional",
    accepts: ["node", "trail", "context"],
    text: "required",
    summary: "Name an object, making it first-class and searchable",
  },
  // No mark, for the same reason `name`'s bare form has none: the only trail
  // the user can address is the one they are on. Nodes are what get marked, and
  // a verb that takes a mark it can never be given is a verb the bar would
  // offer and then refuse. It grows an optional target on the day trails become
  // markable, and not before.
  done: {
    pillar: "trails",
    target: "none",
    accepts: [],
    text: false,
    summary: "Finish this trail: it is kept, but no longer offered on return",
  },

  // Pillar C — the context engine.
  // Optional, not required, and the bare form is the release. A pinned context
  // deliberately survives the next navigation — that is what makes the verb a
  // statement rather than a suggestion — but without a way to say "follow me
  // again" it survives *every* navigation, and the bar goes on ranking by an
  // enquiry the user finished an hour and five tabs ago. `context` alone hands
  // the decision back to provenance, exactly as `back` alone applies to where
  // you already are.
  context: {
    pillar: "context",
    target: "optional",
    accepts: ["context"],
    text: false,
    summary: "Switch the active context, or follow the current trail again",
  },
  pack: {
    pillar: "context",
    target: "none",
    accepts: [],
    text: false,
    summary: "Export the active context as a markdown brief",
  },
  what: {
    pillar: "context",
    target: "none",
    accepts: [],
    text: false,
    summary: "Report what the engine has on the active context",
  },
  // The one verb that is about what the browser may fetch rather than about
  // the session. `FOSEmbeddings` has why the `related` suggestion tier ships
  // switched off: turning it on authorises a ~30MB model download, and a fork
  // that disables update and telemetry precisely so it never contacts anyone
  // unasked cannot make that request on a keystroke into the command bar.
  //
  // Making the consent an action rather than a checkbox is what keeps §5's one
  // code path: it is discoverable in the list the bar opens with, it is
  // sayable, and it is the same token stream as everything else. The summary
  // below is the disclosure *before* the fetch — it is on screen the moment
  // the bar opens — and the notice the handler raises carries the size and the
  // host *during* it.
  model: {
    pillar: "context",
    target: "none",
    accepts: [],
    text: false,
    summary: "Download the local model that ranks suggestions by meaning",
  },

  // The page — the verbs the entry surface owns rather than a pillar. One asks
  // for a page, one gives up on asking, and one reaches into the page that
  // arrived; they are grouped together, and apart from the three pillars,
  // because that is what they have in common and because the alternative was
  // filing `stop` under "Context", which is a heading the user reads and would
  // be simply untrue. `search` moves here with it: it was in the context group
  // for want of a fourth, not because the context engine owns it.
  //
  // Abandoning a request became reachable-by-nothing the moment the fork
  // started writing `browser.userTypedValue` (see `FOSActions.#markAsPending`).
  // Firefox has two halves of an abandon — Escape over the page stops the load,
  // Escape *in the address bar* reverts the pending value — and this fork
  // inherited the first and lost the second, because its bar cannot be focused
  // and so `handleRevert` cannot be reached. A load that stalls therefore left
  // the bar claiming a destination for good, and left session restore ready to
  // reissue a request the user had given up on.
  //
  // It is one verb rather than the two Firefox has because the two were never
  // separately useful: nobody wants the load stopped while the browser goes on
  // saying it is going there. So `stop` does both, and the notice names what
  // was abandoned so the user can ask for it again if stopping was a mistake.
  stop: {
    pillar: "page",
    target: "none",
    accepts: [],
    text: false,
    summary: "Give up on the page being loaded and say where you are again",
  },

  // The one verb that reaches into the page rather than around it.
  //
  // Everything else in this table addresses the browser's own objects — cards,
  // nodes, contexts, trails — and for fifteen verbs that was the whole table.
  // Enumerating the window's keyset (§5.1.1) is what made the omission
  // impossible to keep missing: the fork had a complete spoken grammar for
  // every surface surrounding the page and no way at all to click a link in
  // it. `FOSMarks` had listed "link" among the addressable kinds in its own doc
  // comment since the day marks landed, and nothing had ever registered one.
  //
  // Rango, which is the most developed voice-browsing extension there is, is
  // very nearly this one capability and ships no spoken form for back, reload,
  // find or zoom at all. That is the evidence about where hands-free browsing
  // actually stops, and it is not at the toolbar.
  //
  // **Optional, and the bare form is what makes the links addressable.** This
  // is the shape §8's "voice writes the whole line" forces, and it is a better
  // shape than the one that rule ruled out. A required target would mean the
  // marks appear only while a target slot is pending, which the keyboard can
  // sit in and a voice turn cannot — a spoken "follow" would leave a half-line
  // in the bar and the next utterance would replace it rather than complete it.
  // So `follow` alone is a whole command that puts the marks on the page, and
  // `follow cap` is a whole command that follows one. Both are complete lines
  // in both modalities, and neither needs a mode.
  //
  // It also answers the question a hint overlay always raises, which is where
  // the candidate list goes. For every other verb the list is in the bar,
  // because the objects are not on screen as themselves. For links they are:
  // the mark is drawn *on* the link it addresses, which is strictly more
  // information than a row reading "cap — Downloads" and is why every tool that
  // has solved this draws hints rather than listing them.
  follow: {
    pillar: "page",
    target: "optional",
    accepts: ["link"],
    text: false,
    summary: "Mark the links on this page, or follow the one marked",
  },

  // The escape. GRAMMAR.md §3 makes search the unmarked default, which leaves
  // one gap: a query that happens to begin with an action word. Rather than a
  // bolted-on escape character with no spoken form, the escape is an ordinary
  // action with terminal free text, so it costs the grammar nothing and is
  // reachable in both modalities like everything else. The typed `?` prefix is
  // sugar for exactly this.
  search: {
    pillar: "page",
    target: "none",
    accepts: [],
    text: "required",
    summary: "Search for this text even if it begins with an action word",
  },
});

/** The typed shorthand for `search`. */
export const QUERY_PREFIX = "?";

export const ACTION_WORDS = Object.freeze(Object.keys(ACTIONS));

export function isActionWord(token) {
  return (
    typeof token === "string" && Object.hasOwn(ACTIONS, token.toLowerCase())
  );
}

export function actionSpec(token) {
  return ACTIONS[String(token).toLowerCase()] ?? null;
}
