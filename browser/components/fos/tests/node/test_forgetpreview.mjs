/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The sentence a clear dialog shows about the Context Engine.
 *
 * This is the whole user-visible payload of the preview, and it is pure, so it
 * is checked here rather than by opening a dialog. What a browser test can add
 * on top is only that the line is wired to the right element and the right
 * range; the wording is settled here.
 *
 * Assertions are on fragments rather than whole strings on purpose.
 * `Intl.ListFormat` puts a comma before the final "and" in en-US and not in
 * en-GB, and `toLocaleString` groups thousands differently again, so a test
 * that pinned the whole sentence would be asserting the machine's locale.
 *
 *   node --test browser/components/fos/tests/node/
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

// The module under test is a chrome module and declares its lazy imports at
// module scope. The sentence builder touches none of them — it is arithmetic
// over an object — so a stub that satisfies evaluation is enough, and a
// dynamic import is what puts it in place before the module body runs.
globalThis.ChromeUtils ??= { defineESModuleGetters() {} };
const { describeForgetPreview } =
  await import("../../FOSForgetPreview.sys.mjs");

/**
 * @param {object} fields Overrides on an otherwise empty preview.
 * @returns {object} A `ForgetPreview`.
 */
function preview(fields) {
  return {
    nodes: 0,
    queries: 0,
    contexts: 0,
    trails: 0,
    nodeIds: [],
    contextIds: [],
    all: false,
    contextLabels: [],
    trailNames: [],
    ...fields,
  };
}

test("nothing recorded says nothing at all", () => {
  assert.equal(describeForgetPreview(preview({})), "");
  assert.equal(
    describeForgetPreview(null),
    "",
    "and a preview that could not run is silent rather than confident — " +
      "'0 pages' is a claim, and the wrong one"
  );
});

test("a count that is zero is left out rather than written as zero", () => {
  const text = describeForgetPreview(preview({ nodes: 3 }));
  assert.match(text, /3 pages/);
  assert.doesNotMatch(text, /question/, "no questions were asked here");
  assert.doesNotMatch(text, /trail/);
  assert.doesNotMatch(text, /context/);
});

test("one of a thing is singular", () => {
  const text = describeForgetPreview(
    preview({ nodes: 1, queries: 1, trails: 1, contexts: 1 })
  );
  assert.match(text, /1 page(?!s)/);
  assert.match(text, /1 question(?!s)/);
  assert.match(text, /1 trail(?!s)/);
  assert.match(text, /1 context(?!s)/);
});

test("a range names the engine it is taking from", () => {
  const text = describeForgetPreview(preview({ nodes: 12, queries: 4 }));
  assert.match(text, /^This also takes /);
  assert.match(text, /out of your Context Engine\.$/);
});

test("clearing everything says it empties the engine", () => {
  const text = describeForgetPreview(preview({ nodes: 12, all: true }));
  assert.match(text, /^This empties your Context Engine /);
  assert.doesNotMatch(
    text,
    /out of your Context Engine/,
    "the lead already said which engine, so the tail would repeat it"
  );
});

test("a context is named, because a host and a clock cannot be read for it", () => {
  const text = describeForgetPreview(
    preview({ nodes: 9, contexts: 1, contextLabels: ["reverse mortgages"] })
  );
  assert.match(text, /including the context “reverse mortgages”\.$/);
});

test("two contexts take the plural noun once, not once each", () => {
  const text = describeForgetPreview(
    preview({ nodes: 9, contexts: 2, contextLabels: ["alpha", "beta"] })
  );
  assert.match(text, /including the contexts “alpha”/);
  assert.match(text, /“beta”/);
  assert.equal(
    text.match(/the context/g).length,
    1,
    "one noun over a list, not a noun per name"
  );
});

test("contexts and trails are named as the different things they are", () => {
  const text = describeForgetPreview(
    preview({
      nodes: 9,
      contexts: 1,
      trails: 1,
      contextLabels: ["alpha"],
      trailNames: ["a walk"],
    })
  );
  assert.match(text, /the context “alpha”/);
  assert.match(text, /the trail “a walk”/);
});

test("at most three names, and contexts get the room first", () => {
  const text = describeForgetPreview(
    preview({
      nodes: 9,
      contexts: 4,
      trails: 2,
      contextLabels: ["c1", "c2", "c3", "c4"],
      trailNames: ["t1", "t2"],
    })
  );
  for (const label of ["c1", "c2", "c3"]) {
    assert.match(text, new RegExp(`“${label}”`), `${label} is named`);
  }
  assert.doesNotMatch(text, /“c4”/, "the fourth context does not fit");
  assert.doesNotMatch(
    text,
    /“t1”/,
    "and the trails get no room, because a context label describes work the " +
      "user did not choose the words for and a trail name is one they typed"
  );
  assert.match(
    text,
    /4 contexts/,
    "the counts already said how many, so the names need no 'and 2 more' — " +
      "they are examples of a number the reader has just been given"
  );
});

test("counted contexts with no labels are counted and not named", () => {
  const text = describeForgetPreview(preview({ nodes: 9, contexts: 2 }));
  assert.match(text, /2 contexts/);
  assert.doesNotMatch(
    text,
    /including/,
    "a context is clustered before it is described, so the newest ones have " +
      "no label and there is nothing honest to quote"
  );
});

test("large counts are grouped so they can be read at a glance", () => {
  const text = describeForgetPreview(preview({ nodes: 12345 }));
  assert.doesNotMatch(
    text,
    /12345/,
    "the number is formatted for the locale rather than printed raw"
  );
  assert.match(text, /pages/);
});
