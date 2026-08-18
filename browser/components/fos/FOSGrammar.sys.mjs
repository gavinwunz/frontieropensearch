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

  // The escape. GRAMMAR.md §3 makes search the unmarked default, which leaves
  // one gap: a query that happens to begin with an action word. Rather than a
  // bolted-on escape character with no spoken form, the escape is an ordinary
  // action with terminal free text, so it costs the grammar nothing and is
  // reachable in both modalities like everything else. The typed `?` prefix is
  // sugar for exactly this.
  search: {
    pillar: "context",
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
