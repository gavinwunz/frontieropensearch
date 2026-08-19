/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The one parse path.
 *
 *   keystrokes ─┐
 *               ├─→ token stream ─→ parse ─→ command object ─→ execute
 *   transcript ─┘
 *
 * `design/GRAMMAR.md` §5: both front ends produce a token stream and nothing
 * else. This module has no knowledge of which modality produced its input, and
 * must not acquire any.
 *
 * The parser is incremental by design. It is called on every keystroke, so a
 * half-typed command is a normal result rather than an error: `parse("enter ")`
 * reports a pending target and the types it accepts, which is what drives the
 * bar's live-narrowing candidate list.
 */

import { QUERY_PREFIX, actionSpec, isActionWord } from "./FOSGrammar.sys.mjs";
import { resolveMarkToken } from "./FOSMarks.sys.mjs";

/** Result kinds. */
export const EMPTY = "empty";
export const QUERY = "query";
export const COMMANDS = "commands";
export const ERROR = "error";

/** Error codes, so callers can phrase their own messages. */
export const E_DEAD_MARK = "dead-mark";
export const E_WRONG_TYPE = "wrong-type";

function tokenize(input) {
  const tokens = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    tokens.push({
      raw: match[0],
      value: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * Parse one line, or one transcript.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {MarkRegistry} [options.marks]
 *   When supplied, marks are checked for liveness and for whether the pending
 *   action accepts the object's type. Without it the parse is purely
 *   syntactic, which is what unit tests and the grammar's own tests want.
 * @returns {object} A result whose `type` is one of EMPTY, QUERY, COMMANDS or
 *   ERROR. `commands` always holds whatever parsed cleanly before any error, so
 *   a partial line still renders. `pending` describes the slot the user is
 *   currently filling, or null.
 */
export function parse(input, { marks = null } = {}) {
  const text = String(input ?? "");

  // A line is a command only if the whole line parses as one. The moment a
  // token cannot continue the parse, the line was never a command and is
  // prose — so it becomes a query rather than an error.
  //
  // This matters far more than it looks. Ten of the fifteen action words are
  // ordinary English (`what`, `back`, `up`, `name`, `field`, `context`,
  // `branch`, `pack`, `model`, `stop`), so the queries that collide with them
  // are not exotic: "what is a memex", "back pain", "field of view",
  // "branch prediction", "stop motion animation".
  // Reporting those as a syntax error would hand the user nothing at all for
  // the most natural thing they could type.
  //
  // Chrome shipped the opposite default and retreated from it: before 88.0.4324
  // a keyword plus a space invoked the keyword's engine, and it now takes a
  // deliberate Tab, so `g foo` searches for "g foo". A bare prefix does not get
  // to steal the line. Our rule is that same judgement with more room —
  // an unambiguous complete command still wins, and only the ambiguous
  // remainder falls back to search.
  //
  // The line is drawn at syntax, not semantics: `enter cap` naming a dead or
  // wrong-typed mark is a well-formed command the user plainly meant, so it
  // stays an error instead of silently becoming a web search.
  const asQuery = () => result(QUERY, { query: text.trim() });

  // The typed shorthand for `search`. Sugar, resolved before tokenizing so
  // that `?enter cap` is a query for "enter cap" and not a command.
  if (text.trimStart().startsWith(QUERY_PREFIX)) {
    const rest = text.trimStart().slice(QUERY_PREFIX.length).trim();
    return rest
      ? result(COMMANDS, {
          commands: [{ action: "search", target: null, text: rest }],
        })
      : result(COMMANDS, {
          commands: [],
          pending: { action: "search", expect: "text", accepts: [] },
        });
  }

  const tokens = tokenize(text);
  if (!tokens.length) {
    return result(EMPTY, {});
  }

  // Search is the unmarked default: anything not opening with a known action
  // word is prose, and prose is a query. No mode, ever, in either modality.
  if (!isActionWord(tokens[0].value)) {
    return result(QUERY, { query: text.trim() });
  }

  const commands = [];
  let i = 0;

  while (i < tokens.length) {
    const word = tokens[i].value;
    const spec = actionSpec(word);
    if (!spec) {
      return asQuery();
    }
    i++;

    const cmd = { action: word, target: null, text: null };

    if (spec.target !== "none") {
      const tok = tokens[i];
      if (!tok) {
        if (spec.target === "required") {
          return result(COMMANDS, {
            commands,
            pending: { action: word, expect: "target", accepts: spec.accepts },
          });
        }
        // An optional target simply absent: the verb applies to the current
        // object.
      } else {
        const letter = resolveMarkToken(tok.value);
        if (letter) {
          const typeError = checkMark(letter, spec, marks, tok);
          if (typeError) {
            return result(ERROR, { commands, error: typeError });
          }
          cmd.target = letter;
          i++;
        } else if (spec.target === "required") {
          return asQuery();
        }
        // Optional target, and the token is not a mark. It therefore begins
        // the free text, and the verb applies to the current object. This is
        // the rule that makes `name gecko session` unambiguous; a mark token
        // fills the slot, anything else does not. Naming something literally
        // "cap" needs `name cap cap`, which is a smaller tax than a mode.
      }
    }

    if (spec.text) {
      const tok = tokens[i];
      if (!tok) {
        return result(COMMANDS, {
          commands,
          pending: { action: word, expect: "text", accepts: [] },
        });
      }
      // Free text is terminal: it takes the rest of the line verbatim, so a
      // name may contain action words without being re-segmented.
      cmd.text = text.slice(tok.start).trim();
      i = tokens.length;
    }

    commands.push(cmd);

    if (i < tokens.length && !isActionWord(tokens[i].value)) {
      return asQuery();
    }
  }

  return result(COMMANDS, { commands });
}

function checkMark(letter, spec, marks, tok) {
  if (!marks) {
    return null;
  }
  if (!marks.isLive(letter)) {
    return { code: E_DEAD_MARK, token: tok.raw, at: tok.start, letter };
  }
  const type = marks.typeAt(letter);
  if (spec.accepts.length && !spec.accepts.includes(type)) {
    return {
      code: E_WRONG_TYPE,
      token: tok.raw,
      at: tok.start,
      letter,
      got: type,
      accepts: spec.accepts,
    };
  }
  return null;
}

function result(
  type,
  { commands = [], pending = null, error = null, query = null }
) {
  return { type, commands, pending, error, query };
}

/**
 * The candidate marks for a pending slot, ready for the bar to render. Shared
 * by both modalities: the keyboard user sees this list, and it is the same set
 * the voice grammar will accept next.
 *
 * @param {?object} pending A parse result's pending slot.
 * @param {?MarkRegistry} marks The live registry.
 */
export function candidatesFor(pending, marks) {
  if (!pending || pending.expect !== "target" || !marks) {
    return [];
  }
  return marks.candidates(pending.accepts.length ? pending.accepts : null);
}
