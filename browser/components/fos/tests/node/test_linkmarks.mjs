/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the page's alphabet: which links get a letter, what they are
 * called, and how a letter is resolved when two scopes hold it.
 *
 * The half of link marks that needs a page is in
 * `tests/browser/browser_links.js`. Everything here is the half that does not,
 * which is deliberately most of it — the actor was kept to "walk the DOM and
 * draw what you are told" precisely so that the decisions could be tested in a
 * second rather than in a build.
 *
 *   browser/components/fos/tests/node/run.sh
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import { MarkRegistry, ScopedMarks } from "../../FOSMarks.sys.mjs";
import {
  HINT_LIMIT,
  chooseMarkable,
  labelFor,
  markedMessage,
} from "../../FOSLinkMarks.sys.mjs";
import { ACTIONS } from "../../FOSGrammar.sys.mjs";
import {
  parse,
  COMMANDS,
  ERROR,
  E_DEAD_MARK,
  E_WRONG_TYPE,
} from "../../FOSCommandParser.sys.mjs";

// ---- labels -------------------------------------------------------------

test("a link is named by its text first", () => {
  assert.equal(
    labelFor({ text: "  Downloads\n ", aria: "nav", host: "example.org" }),
    "Downloads"
  );
});

test("a link with no text falls back to what a screen reader would say", () => {
  // The image link and the icon link: the ones with no text at all, and the
  // ones a hands-free user most needs a guessable letter for.
  assert.equal(labelFor({ text: "  ", aria: "Home", host: "x.org" }), "Home");
  assert.equal(
    labelFor({ text: "", aria: "", host: "docs.gecko.org" }),
    "docs.gecko.org"
  );
  assert.equal(labelFor({}), "");
});

test("the host loses the prefix every host shares", () => {
  // The trail rail learned this the hard way: labels derived from "https://"
  // gave the first four nodes of every session h, t, p and s, and stickiness
  // made it permanent. `www.` is the same failure one level down.
  assert.equal(labelFor({ host: "www.wikipedia.org" }), "wikipedia.org");
});

// ---- choosing -----------------------------------------------------------

const link = (id, label, href = `https://x.test/${id}`) => ({
  id,
  label,
  href,
});

test("the alphabet is the limit, and it is stated as the alphabet", () => {
  assert.equal(HINT_LIMIT, 26);
});

test("two links to one destination share one mark", () => {
  // The thumbnail and the headline above it. One thing to the user, two hints
  // in every tool that has drawn hints, and the merge buys back letters on
  // exactly the pages dense enough to run out of them.
  const { marked, total, dropped } = chooseMarkable([
    link(0, "Gecko", "https://x.test/a"),
    link(1, "A picture of a gecko", "https://x.test/a"),
    link(2, "Trails", "https://x.test/b"),
  ]);
  assert.equal(total, 2);
  assert.equal(dropped, 0);
  assert.equal(marked.length, 2);
  // The first in document order is the one that keeps its identity; the second
  // is an alias, so a hint is still drawn on it.
  assert.equal(marked[0].id, 0);
  assert.deepEqual(marked[0].aliases, [1]);
  assert.deepEqual(marked[1].aliases, []);
});

test("a link with no destination merges with nothing", () => {
  // `role="link"` with no href. Two of them are two things, because there is
  // no evidence they are one.
  const { marked, total } = chooseMarkable([
    link(0, "One", ""),
    link(1, "Two", ""),
  ]);
  assert.equal(total, 2);
  assert.deepEqual(
    marked.map(m => m.id),
    [0, 1]
  );
});

test("past twenty-six, the rest are dropped and counted", () => {
  const many = Array.from({ length: 40 }, (_, i) => link(i, `link ${i}`));
  const outcome = chooseMarkable(many);
  assert.equal(outcome.marked.length, 26);
  assert.equal(outcome.total, 40);
  assert.equal(outcome.dropped, 14);
  // Document order, so what survives is the first twenty-six as the page
  // presents them rather than an order the browser invented.
  assert.deepEqual(
    outcome.marked.map(m => m.id),
    Array.from({ length: 26 }, (_, i) => i)
  );
});

test("nothing at all is not an error", () => {
  const outcome = chooseMarkable([]);
  assert.deepEqual(outcome, { marked: [], total: 0, dropped: 0 });
  assert.equal(chooseMarkable(undefined).total, 0);
});

// ---- what the user is told ----------------------------------------------

test("a truncated page says both numbers", () => {
  // The one that matters. "26 links marked" on a page of eighty is true and
  // useless: it is the fifty-four missing ones that decide whether the user
  // goes on speaking or reaches for the mouse.
  const message = markedMessage({
    marked: new Array(26),
    total: 80,
    dropped: 54,
  });
  assert.match(message, /26 of 80/);
  assert.match(message, /54/);
});

test("an untruncated page says one number, and counts in English", () => {
  assert.equal(
    markedMessage({ marked: new Array(4), total: 4, dropped: 0 }),
    "4 links marked."
  );
  assert.equal(
    markedMessage({ marked: [1], total: 1, dropped: 0 }),
    "1 link marked."
  );
  assert.equal(
    markedMessage({ marked: [], total: 0, dropped: 0 }),
    "No links on this page."
  );
});

// ---- the grammar --------------------------------------------------------

test("follow is one verb with an optional target, taking a link", () => {
  // The shape is load-bearing, not incidental: a required target would put the
  // marks up only while a slot is pending, which the keyboard can sit in and a
  // voice turn cannot. Both forms have to be whole lines.
  assert.deepEqual(ACTIONS.follow.accepts, ["link"]);
  assert.equal(ACTIONS.follow.target, "optional");
  assert.equal(ACTIONS.follow.text, false);
});

test("both forms of follow parse as complete commands", () => {
  const bare = parse("follow");
  assert.equal(bare.type, COMMANDS);
  assert.equal(bare.pending, null);
  assert.deepEqual(bare.commands, [
    { action: "follow", target: null, text: null },
  ]);

  const marks = new MarkRegistry();
  marks.assign("link:3", { label: "cap", type: "link" });
  const targeted = parse("follow cap", { marks });
  assert.equal(targeted.type, COMMANDS);
  assert.equal(targeted.commands[0].target, "c");
});

test("follow is an ordinary English word and does not steal the line", () => {
  // Twelve of the seventeen action words are ordinary English, and this is the
  // rule that keeps them usable as search terms.
  assert.equal(parse("follow the money").type, "query");
  assert.equal(parse("follow up on that").type, "query");
});

// ---- two alphabets ------------------------------------------------------

/**
 * A window registry and a page registry holding the same letter, which is the
 * whole situation `ScopedMarks` exists for.
 */
function twoScopes() {
  const chrome = new MarkRegistry();
  const page = new MarkRegistry();
  chrome.assign("node:1", { label: "cap", type: "node" });
  page.assign("link:7", { label: "cap", type: "link" });
  assert.equal(chrome.markOf("node:1"), "c");
  assert.equal(page.markOf("link:7"), "c");
  return { chrome, page, marks: new ScopedMarks([chrome]).add(page) };
}

test("one letter means two things, and the verb decides which", () => {
  const { marks } = twoScopes();
  assert.equal(marks.typeAt("c", ["node"]), "node");
  assert.equal(marks.objectAt("c", ["node"]), "node:1");
  assert.equal(marks.typeAt("c", ["link"]), "link");
  assert.equal(marks.objectAt("c", ["link"]), "link:7");
  // Unfiltered, the longer-lived scope wins, because the tie has to break
  // somewhere and a page must not shadow a mark learned on a card.
  assert.equal(marks.typeAt("c"), "node");
});

test("the parser resolves a mark in the scope the verb accepts", () => {
  // The bug this prevents: asking what holds `c` and comparing afterwards gives
  // the node, and a wrong-type error for `follow cap` — a command that was
  // perfectly well-formed and that the user could see was well-formed, because
  // the letter was drawn on the link in front of them.
  const { marks } = twoScopes();
  assert.equal(parse("follow cap", { marks }).commands[0].target, "c");
  assert.equal(parse("enter cap", { marks }).commands[0].target, "c");
});

test("a letter no scope holds is dead, not wrong-typed", () => {
  const { marks } = twoScopes();
  const r = parse("follow zip", { marks });
  assert.equal(r.type, ERROR);
  assert.equal(r.error.code, E_DEAD_MARK);
});

test("a letter only the wrong scope holds is wrong-typed, and names the kind", () => {
  // Telling the user this mark does not exist would send them looking for a
  // letter that is on their screen. It exists; it is the wrong kind of thing.
  const chrome = new MarkRegistry();
  chrome.assign("node:1", { label: "gecko", type: "node" });
  const marks = new ScopedMarks([chrome]).add(new MarkRegistry());
  const r = parse("follow gust", { marks });
  assert.equal(r.type, ERROR);
  assert.equal(r.error.code, E_WRONG_TYPE);
  assert.equal(r.error.got, "node");
  assert.deepEqual(r.error.accepts, ["link"]);
});

test("candidates come from every scope and a letter appears once", () => {
  const { marks } = twoScopes();
  assert.deepEqual(
    marks.candidates(["link"]).map(r => r.id),
    ["link:7"]
  );
  assert.deepEqual(
    marks.candidates(["node"]).map(r => r.id),
    ["node:1"]
  );
  const all = marks.candidates();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "node:1");
});

test("an empty page scope changes nothing", () => {
  // The state every window is in until the first `follow`, and the one that
  // must not be able to break the other three kinds of mark.
  const chrome = new MarkRegistry();
  chrome.assign("node:1", { label: "gecko", type: "node" });
  const marks = new ScopedMarks([chrome]).add(new MarkRegistry());
  assert.equal(parse("enter gust", { marks }).commands[0].target, "g");
  assert.equal(marks.candidates().length, 1);
});

test("a scope added twice is added once", () => {
  const page = new MarkRegistry();
  page.assign("link:1", { label: "cap", type: "link" });
  const marks = new ScopedMarks().add(page).add(page);
  assert.equal(marks.candidates().length, 1);
});

test("a registry and a scoped view answer the parser identically", () => {
  // The property that lets `parse` take either without knowing which, and the
  // reason `entryAt` takes an `accepts` argument it ignores.
  const registry = new MarkRegistry();
  registry.assign("node:1", { label: "gecko", type: "node" });
  const scoped = new ScopedMarks([registry]);
  for (const marks of [registry, scoped]) {
    assert.equal(parse("enter gust", { marks }).commands[0].target, "g");
    assert.equal(parse("enter cap", { marks }).error.code, E_DEAD_MARK);
    assert.equal(parse("follow gust", { marks }).error.code, E_WRONG_TYPE);
  }
});

test("a label made only of a glyph is not a label", () => {
  // `<a aria-label="Demonstration">▶</a>`, which is how icon links are actually
  // written. The text is not empty, so a chain testing emptiness stops there
  // and derives a mnemonic from a character in no alphabet — handing an
  // arbitrary letter to exactly the links with nothing on screen to read.
  assert.equal(labelFor({ text: "▶", aria: "Demonstration" }), "Demonstration");
  assert.equal(
    labelFor({ text: "●", aria: "", host: "notes.test" }),
    "notes.test"
  );
  // And it is still shown when there is nothing better, because a badge beside
  // a glyph beats a blank row.
  assert.equal(labelFor({ text: "▶" }), "▶");
});
