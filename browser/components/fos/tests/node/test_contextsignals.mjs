/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the Context Engine's pure derivations.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import {
  READ_DWELL_MS,
  canonicalise,
  deriveOutcome,
  extractEntities,
  normaliseIntent,
} from "../../FOSContextSignals.sys.mjs";

/**
 * @param {string} text
 * @returns {string[]} Canonical forms, strongest first.
 */
function names(text) {
  return extractEntities(text).map(entity => entity.canonical);
}

test("normaliseIntent drops stopwords and keeps order", () => {
  assert.equal(
    normaliseIntent("What is the Memex, and how does it work?"),
    "memex work"
  );
  assert.equal(normaliseIntent("  SPACED   Out  "), "spaced out");
});

test("normaliseIntent preserves word order, because the phrase is the meaning", () => {
  assert.notEqual(
    normaliseIntent("does a bird fly"),
    normaliseIntent("does a fly bird")
  );
});

test("a query made only of stopwords survives", () => {
  // Emptying it would make every such query match every other one.
  assert.equal(normaliseIntent("how do you do"), "how do you do");
});

test("non-Latin text is not shredded", () => {
  assert.equal(normaliseIntent("mémoire associative"), "mémoire associative");
  assert.equal(normaliseIntent("記憶 の 装置"), "記憶 の 装置");
});

test("a quoted phrase is the strongest evidence and is a work", () => {
  const [first] = extractEntities('Bush wrote "As We May Think" in 1945.');
  assert.equal(first.canonical, "as we may think");
  assert.equal(first.kind, "work");
  assert.equal(first.weight, 1);
});

test("a name is counted once, not once per word", () => {
  // The regression: "Vannevar Bush" also produced loose `vannevar` and `bush`,
  // reporting one mention as three and skewing every ranking downstream.
  const found = names("Ted Nelson called it Xanadu.");
  assert.ok(found.includes("ted nelson"));
  assert.ok(!found.includes("ted"));
  assert.ok(!found.includes("nelson"));
});

test("a capital at the start of a sentence is grammar, not evidence", () => {
  const entities = extractEntities("Memex trails and associative indexing.");
  const memex = entities.find(entity => entity.canonical === "memex");
  // Present, but at plain weight — nothing about it says "name".
  assert.ok(memex);
  assert.equal(memex.weight, 0.3);
});

test("a mid-sentence capital outranks a plain word", () => {
  const entities = extractEntities("the history of Xanadu and hypertext");
  const byName = Object.fromEntries(
    entities.map(entity => [entity.canonical, entity.weight])
  );
  assert.ok(byName.xanadu > byName.hypertext);
});

test("repetition adds with diminishing returns and stays in range", () => {
  const [strongest] = extractEntities("memex memex memex memex memex memex");
  assert.ok(strongest.weight > 0.3, "repetition counts for something");
  assert.ok(strongest.weight <= 1, "weights stay comparable with a model's");
});

test("a bare stopword is never an entity, however capitalised", () => {
  assert.ok(!names("What Is It").includes("what"));
});

test("canonicalise is the deduplication key", () => {
  assert.equal(canonicalise("  As We May THINK! "), "as we may think");
  assert.equal(canonicalise("Ted Nelson"), canonicalise("ted   nelson"));
});

test("outcome is derived from dwell against the 30s threshold", () => {
  assert.equal(READ_DWELL_MS, 30_000);
  assert.equal(deriveOutcome({ dwellMs: READ_DWELL_MS }), "read");
  assert.equal(deriveOutcome({ dwellMs: READ_DWELL_MS - 1 }), "bounced");
  assert.equal(deriveOutcome({ dwellMs: 0 }), "bounced");
});

test("an explicit save outranks the clock", () => {
  assert.equal(deriveOutcome({ dwellMs: 10, saved: true }), "saved");
});

test("the threshold is overridable, because it is a floor and not a fact", () => {
  assert.equal(deriveOutcome({ dwellMs: 5000, readThresholdMs: 1000 }), "read");
});

test("a name keeps the lowercase words inside it", () => {
  // Found in a screenshot of the context sidebar: a run of capitals alone cut
  // this title into "The Mother" and "All Demos", two fragments neither of
  // which is a thing, both shown to the user as what the context was about.
  const found = names("The Mother of All Demos changed everything.");
  assert.ok(
    found.includes("the mother of all demos"),
    `the whole title is one entity, got ${JSON.stringify(found)}`
  );
  assert.ok(!found.includes("the mother"), "and not the half of it");
  assert.ok(!found.includes("all demos"), "nor the other half");
});

test("a joiner does not glue two names together", () => {
  // `and` is deliberately not a joiner: it is the word that most often
  // separates two names, and admitting it would produce one entity that
  // nothing is about.
  // Not phrased with a capital at the start: a sentence-initial capital that
  // runs straight into a name is glued to it, which is a limitation of
  // capitalisation as evidence rather than of the joiner list, and is why the
  // extractor calls itself shallow.
  const found = names("It compares Project Xanadu and Vannevar Bush.");
  assert.ok(found.includes("project xanadu"), "the first name survives");
  assert.ok(found.includes("vannevar bush"), "and so does the second");
  assert.ok(
    !found.some(entry => entry.includes(" and ")),
    `nothing was glued across the conjunction, got ${JSON.stringify(found)}`
  );
});

test("a trailing joiner is not eaten", () => {
  const found = names("Ted Nelson wrote of hypertext.");
  assert.ok(found.includes("ted nelson"), "the name is the name");
  assert.ok(
    !found.some(entry => entry.endsWith(" of")),
    `no name ends in its joiner, got ${JSON.stringify(found)}`
  );
});
