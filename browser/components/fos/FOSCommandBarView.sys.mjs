/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The command bar's view model: a parse result in, a description of what the
 * bar should show out.
 *
 * This is deliberately separate from the DOM. Everything here is a pure
 * function of the parse result plus the mark registry, which is what lets the
 * bar's behaviour be tested at speed in node while the module that touches
 * chrome stays thin enough to be checked in Gecko by eye and by a handful of
 * browser-chrome tests. Two of this project's shipped defects were invisible to
 * green node tests, so the split is drawn to keep the untestable part small
 * rather than to pretend it does not exist.
 *
 * ---
 *
 * WHY THE LIST IS NEVER EMPTY
 *
 * The failure mode reported over and over for command palettes is
 * discoverability, and it has two halves: users never find the palette, and
 * users who find it are shown a bare input that teaches them nothing. The
 * standard advice is to show suggestions the moment the palette opens rather
 * than an empty box or an alphabetical dump of everything.
 *
 * That advice lands harder here than it does on a palette in an editor, and in
 * an inverted way. The usual critique is that a palette must not withhold what
 * the menus already expose — but this bar *is* the only entry surface, so there
 * are no menus to fall back to. Incompleteness is therefore not our risk;
 * the risk is a user who does not know the fifteen words having nowhere at all
 * to learn them. So the empty state is the action table itself, grouped by
 * pillar, and it is the one screen in the product that has to teach.
 *
 * WHY DISCOVERABILITY MUST NOT BECOME A MODE
 *
 * A half-typed action word is prose by `design/GRAMMAR.md` §3 — `fie` is a
 * query, and pressing Enter must search for it. But showing nothing while the
 * user types `fie` wastes the moment they are most likely to be reaching for
 * `field`.
 *
 * So the bar lists the action words a single token prefixes, and <kbd>Tab</kbd>
 * completes to one. This changes what is *shown*, never what Enter does, which
 * is the whole point: the grammar keeps search as the unmarked default and the
 * list does the teaching. Chrome settled on the same gesture for the same
 * reason when it stopped letting a bare keyword steal the line.
 *
 * Tab has no spoken form, and it does not need one. §5's requirement is that
 * every *action* be reachable in both modalities; Tab reaches no action, it
 * only saves keystrokes on the way to one a voice user would simply say
 * outright. A completion affordance is not a command.
 */

import { ACTIONS } from "./FOSGrammar.sys.mjs";
import {
  COMMANDS,
  E_DEAD_MARK,
  E_WRONG_TYPE,
  EMPTY,
  ERROR,
  QUERY,
  candidatesFor,
} from "./FOSCommandParser.sys.mjs";
import { markWord } from "./FOSMarks.sys.mjs";

/** Status kinds, so the bar can style each without matching on prose. */
export const S_TEACH = "teach";
export const S_QUERY = "query";
export const S_URL = "url";
export const S_PENDING = "pending";
export const S_READY = "ready";
export const S_ERROR = "error";

/** Row kinds. */
export const R_ACTION = "action";
export const R_MARK = "mark";
export const R_COMMAND = "command";

/**
 * Human-facing names for the pillars, used as group headings.
 *
 * Four headings for three pillars, because some verbs belong to the entry
 * surface itself: `search` asks for a page, `stop` gives up on asking, and
 * `follow` reaches into the page that arrived. The key is `page` rather than
 * `bar` so the heading names what the verbs act on, which is what the other
 * three do — and it is what made room for `follow` without a fifth heading.
 */
const PILLAR_NAMES = Object.freeze({
  field: "The Field",
  trails: "Trails",
  context: "Context",
  page: "The page",
});

/**
 * Every action word a single token is a prefix of.
 *
 * Only ever called with the whole input, and only meaningful when that input is
 * one token: `field of view` is prose about optics and must not be offered a
 * completion, because offering one would imply Enter might do something other
 * than search.
 *
 * @param {string} input
 * @returns {string[]} Matching action words, or empty.
 */
export function completionsFor(input) {
  const text = String(input ?? "");
  if (!text || /\s/.test(text)) {
    return [];
  }
  const lower = text.toLowerCase();
  return Object.keys(ACTIONS).filter(
    word => word.startsWith(lower) && word !== lower
  );
}

function actionRows(words) {
  return words.map(word => ({
    kind: R_ACTION,
    id: `action-${word}`,
    key: word,
    label: word,
    detail: ACTIONS[word].summary,
    group: PILLAR_NAMES[ACTIONS[word].pillar],
  }));
}

function markRows(candidates) {
  return candidates.map(candidate => ({
    kind: R_MARK,
    id: `mark-${candidate.letter}`,
    key: candidate.letter,
    label: candidate.letter,
    spoken: markWord(candidate.letter),
    detail: candidate.label || candidate.type,
    group: null,
  }));
}

function errorText(error) {
  switch (error.code) {
    case E_DEAD_MARK:
      return `Nothing is marked ${error.letter} — say "${markWord(
        error.letter
      )}"`;
    case E_WRONG_TYPE:
      return `${error.letter} is a ${error.got}; that takes a ${error.accepts.join(
        " or a "
      )}`;
    default:
      return "That command cannot run";
  }
}

/**
 * Build everything the bar renders.
 *
 * @param {object} result A parse result from `FOSCommandParser.parse`.
 * @param {object} [options]
 * @param {?MarkRegistry} [options.marks] The live registry, for candidate rows.
 * @param {?object} [options.resolved] What `FOSActions.resolveInput` made of a
 *   query, when the caller is in a runtime that can answer that. Absent in
 *   node, which is why the view never computes it itself.
 * @param {string} [options.input] The raw input, for completions.
 * @returns {object} `{status, rows, canRun}`.
 */
export function viewFor(
  result,
  { marks = null, resolved = null, input = "" } = {}
) {
  switch (result.type) {
    case EMPTY:
      return {
        status: { kind: S_TEACH, text: "Type to search, or use a command" },
        rows: actionRows(Object.keys(ACTIONS)),
        canRun: false,
      };

    case QUERY: {
      // A query is always runnable — that is what makes search the unmarked
      // default. The completions below never change that.
      const rows = actionRows(completionsFor(input || result.query));
      const isURL = resolved?.kind === "url";
      return {
        status: {
          kind: isURL ? S_URL : S_QUERY,
          text: isURL
            ? `Go to ${resolved.display}`
            : `Search for ${resolved?.display ?? result.query}`,
        },
        rows,
        canRun: true,
      };
    }

    case ERROR:
      return {
        status: { kind: S_ERROR, text: errorText(result.error) },
        rows: [],
        canRun: false,
      };

    case COMMANDS: {
      if (result.pending) {
        const { action, expect } = result.pending;
        if (expect === "target") {
          const candidates = candidatesFor(result.pending, marks);
          return {
            status: {
              kind: S_PENDING,
              text: candidates.length
                ? `${action} which?`
                : `Nothing here can be ${action}ed yet`,
            },
            rows: markRows(candidates),
            canRun: false,
          };
        }
        return {
          status: { kind: S_PENDING, text: `${action} what?` },
          rows: [],
          canRun: false,
        };
      }

      return {
        status: {
          kind: S_READY,
          text: result.commands
            .map(cmd => ACTIONS[cmd.action].summary)
            .join(", then "),
        },
        rows: result.commands.map((cmd, i) => ({
          kind: R_COMMAND,
          id: `command-${i}`,
          key: cmd.action,
          label: [cmd.action, cmd.target, cmd.text].filter(Boolean).join(" "),
          detail: ACTIONS[cmd.action].summary,
          group: null,
        })),
        canRun: true,
      };
    }

    default:
      return {
        status: { kind: S_TEACH, text: "" },
        rows: [],
        canRun: false,
      };
  }
}
