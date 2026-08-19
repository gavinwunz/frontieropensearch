/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the command bar's view model.
 *
 * The view model is a pure function of a parse result and the mark registry,
 * which is exactly why it lives apart from the DOM: the bar's *behaviour* —
 * what it offers, what it refuses to run, what it says is about to happen — is
 * checkable here in milliseconds, and only pixels and event plumbing are left
 * for the browser-chrome tests.
 *
 *   node --test browser/components/fos/tests/node/
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import { ACTIONS } from "../../FOSGrammar.sys.mjs";
import { parse } from "../../FOSCommandParser.sys.mjs";
import { MarkRegistry } from "../../FOSMarks.sys.mjs";
import {
  R_ACTION,
  R_COMMAND,
  R_MARK,
  S_ERROR,
  S_PENDING,
  S_QUERY,
  S_READY,
  S_TEACH,
  S_URL,
  completionsFor,
  viewFor,
} from "../../FOSCommandBarView.sys.mjs";

/**
 * The view for a line, parsed the way the bar parses it.
 *
 * @param {string} input The line as typed.
 * @param {object} [options]
 * @param {?MarkRegistry} [options.marks] The registry to resolve marks against.
 * @param {?object} [options.resolved] A stand-in for what Gecko's URI fixup
 *   would have said, since node has no fixup to ask.
 * @returns {object} The view model.
 */
function view(input, { marks = null, resolved = null } = {}) {
  return viewFor(parse(input, { marks }), { marks, resolved, input });
}

test("the empty state teaches the whole action table", () => {
  const v = view("");

  assert.equal(v.status.kind, S_TEACH);
  assert.equal(v.canRun, false);

  // The failure mode the research is unanimous on is a palette that opens to a
  // bare input. This bar is the only entry surface in the product, so there is
  // no menu to learn the verbs from instead — if this list is ever empty, the
  // fifteen words become unlearnable.
  assert.equal(v.rows.length, Object.keys(ACTIONS).length);
  assert.ok(v.rows.every(row => row.kind === R_ACTION));
  assert.ok(v.rows.every(row => row.detail));

  // Grouped, so the list reads as four small sets rather than one long one.
  // Three of the four are the pillars; the fourth is the two verbs the entry
  // surface owns, `search` and `stop` — one asks for a page and one gives up
  // on asking.
  //
  // Contiguity rather than membership, because the grouping is drawn by
  // walking the rows once: a group whose verbs are not adjacent in the action
  // table is drawn as two headings with the same name, and nothing about the
  // set of groups would show it.
  const order = v.rows.map(row => row.group);
  const runs = order.filter((group, i) => group !== order[i - 1]);
  assert.deepEqual(runs, ["The Field", "Trails", "Context", "The page"]);
});

test("prose is a query and is always runnable", () => {
  for (const line of [
    "what is a memex",
    "back pain",
    "field of view",
    "branch prediction",
  ]) {
    const v = view(line);
    assert.equal(v.status.kind, S_QUERY, line);
    assert.equal(v.canRun, true, line);
  }
});

test("a half-typed action word is offered without becoming a command", () => {
  const v = view("fie");

  // Shown: the completion. Meant: still a search. This is the line the whole
  // discoverability affordance has to stay behind — GRAMMAR.md §3 makes search
  // the unmarked default, and a suggestion list must not quietly repeal it.
  assert.deepEqual(
    v.rows.map(row => row.label),
    ["field"]
  );
  assert.equal(v.status.kind, S_QUERY);
  assert.equal(v.canRun, true);
  assert.match(v.status.text, /^Search for /);
});

test("completions never fire on more than one token", () => {
  // `field of view` begins with a whole action word and is still prose. If
  // completions keyed on the first token instead of the whole input, every
  // multi-word query starting with one of the eight ordinary English verbs
  // would sprout a suggestion implying Enter might not search.
  assert.deepEqual(completionsFor("field of view"), []);
  assert.deepEqual(completionsFor("ba"), ["back"]);
  assert.deepEqual(completionsFor(""), []);

  // A complete word is not its own completion; there is nothing left to offer.
  assert.deepEqual(completionsFor("field"), []);
});

test("a URL query says go, not search", () => {
  // The URL-or-search decision is Gecko's (nsIURIFixup), so the view is handed
  // the answer rather than guessing at one. This asserts it renders whichever
  // it is told.
  const asURL = view("example.org", {
    resolved: { kind: "url", display: "https://example.org/" },
  });
  assert.equal(asURL.status.kind, S_URL);
  assert.match(asURL.status.text, /^Go to https:\/\/example\.org\//);

  const asSearch = view("gecko session history", {
    resolved: { kind: "search", display: "gecko session history" },
  });
  assert.equal(asSearch.status.kind, S_QUERY);
});

test("a pending target lists only the marks the verb accepts", () => {
  const marks = new MarkRegistry();
  const card = marks.assign("card-1", { label: "gecko", type: "node" });
  const context = marks.assign("ctx-1", { label: "reading", type: "context" });

  const v = view("enter ", { marks });

  assert.equal(v.status.kind, S_PENDING);
  assert.equal(v.canRun, false);
  assert.ok(v.rows.every(row => row.kind === R_MARK));

  const letters = v.rows.map(row => row.key);
  assert.ok(letters.includes(card), "the card is a candidate for `enter`");
  assert.ok(
    !letters.includes(context),
    "a context is not, so it must not be offered"
  );

  // Every mark row carries its spoken form. A user who is never shown the word
  // cannot say it, and this bar is the only place it is ever shown.
  assert.ok(v.rows.every(row => row.spoken));
});

test("an empty candidate list says so rather than showing nothing", () => {
  const v = view("enter ", { marks: new MarkRegistry() });
  assert.equal(v.status.kind, S_PENDING);
  assert.deepEqual(v.rows, []);
  assert.match(v.status.text, /Nothing here/);
});

test("a complete command is runnable and describes itself", () => {
  const marks = new MarkRegistry();
  const card = marks.assign("card-1", { label: "gecko", type: "node" });

  const v = view(`enter ${card}`, { marks });

  assert.equal(v.status.kind, S_READY);
  assert.equal(v.canRun, true);
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].kind, R_COMMAND);
  assert.equal(v.status.text, ACTIONS.enter.summary);
});

test("a chain describes every step in order", () => {
  const marks = new MarkRegistry();
  const card = marks.assign("card-1", { label: "gecko", type: "node" });

  const v = view(`enter ${card} branch`, { marks });

  assert.equal(v.canRun, true);
  assert.deepEqual(
    v.rows.map(row => row.key),
    ["enter", "branch"]
  );
  assert.equal(
    v.status.text,
    `${ACTIONS.enter.summary}, then ${ACTIONS.branch.summary}`
  );
});

test("a semantic error is refused, not silently searched", () => {
  const marks = new MarkRegistry();
  const context = marks.assign("ctx-1", { label: "reading", type: "context" });

  // GRAMMAR.md §3 draws the line at syntax: `enter <a real mark of the wrong
  // type>` is a well-formed command the user plainly meant, so turning it into
  // a web search would be the exact failure the fallback rule exists to
  // prevent.
  const v = view(`enter ${context}`, { marks });

  assert.equal(v.status.kind, S_ERROR);
  assert.equal(v.canRun, false);
  assert.match(v.status.text, /context/);
});

test("a dead mark names its spoken form in the error", () => {
  const marks = new MarkRegistry();
  marks.assign("card-1", { label: "gecko", type: "node" });

  // `q` holds nothing, so this is a live-mark failure rather than a typo the
  // user can see. Naming the spoken form is what makes the message usable by
  // someone who reached the bar by voice.
  const v = view("enter q", { marks });

  assert.equal(v.status.kind, S_ERROR);
  assert.match(v.status.text, /quench/);
});
