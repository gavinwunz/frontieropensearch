/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The context sidebar’s view model.
 *
 * What is worth testing here is what appears and in what order — the decisions
 * — rather than the DOM, which is `browser_contextsidebar.js`'s job.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  crossingRows,
  dwellLabel,
  moveSelection,
  questionRows,
  relativeTime,
  sidebarFor,
  summariseContents,
} from "../../FOSContextSidebarView.sys.mjs";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * @param {object} [overrides]
 * @returns {object} A `contextContents` shape.
 */
function contents(overrides = {}) {
  return {
    context: { id: 1, label: "Memex", created_at: NOW - DAY, active_at: NOW },
    queries: [],
    pages: [],
    entities: [],
    ...overrides,
  };
}

/**
 * @param {object} [overrides]
 * @returns {object} A page row as `contextContents` returns one.
 */
function page(overrides = {}) {
  return {
    id: 10,
    url: "https://example.org/a",
    title: "A page",
    dismissed_at: null,
    trail_id: 1,
    trail_name: "Reading",
    dwell_ms: 5000,
    outcome: "read",
    ...overrides,
  };
}

// ---- the summary sentence -------------------------------------------------

test("summariseContents counts questions, pages and reads", () => {
  const summary = summariseContents(
    contents({
      queries: [{ id: 1 }],
      pages: [
        page({ id: 1, outcome: "read" }),
        page({ id: 2, outcome: "saved" }),
        page({ id: 3, outcome: "bounced" }),
      ],
    })
  );
  assert.equal(summary, "Memex: 1 question, 3 pages, 2 read");
});

test("summariseContents names an unnamed context rather than its id", () => {
  const summary = summariseContents(
    contents({ context: { id: 4, label: "" } })
  );
  assert.match(summary, /^an unnamed context: /);
});

test("summariseContents lists only entities above the noise floor", () => {
  const summary = summariseContents(
    contents({
      entities: [
        { name: "Bush", weight: 0.9, mentions: 3, kind: "person" },
        { name: "the", weight: 0.1, mentions: 9, kind: "term" },
      ],
    })
  );
  assert.match(summary, /about Bush$/);
});

test("the panel's summary does not repeat the heading's label", () => {
  const named = {
    context: { label: "memex research" },
    queries: [{ id: 1 }],
    pages: [{ outcome: "read" }],
    entities: [],
  };
  const spoken = summariseContents(named);
  const shown = summariseContents(named, { withLabel: false });
  assert.match(spoken, /^memex research: /);
  assert.ok(!shown.includes("memex research"));
  assert.match(shown, /^1 question, 1 page, 1 read/);
});

test("summariseContents answers before there is a context at all", () => {
  assert.match(summariseContents(null), /^No context yet/);
  assert.match(summariseContents(null, { withLabel: false }), /^Browse/);
});

// ---- times and durations --------------------------------------------------

test("relativeTime is coarse, and silent about the last minute", () => {
  assert.equal(relativeTime(NOW - 5000, NOW), "just now");
  assert.equal(relativeTime(NOW - 5 * MINUTE, NOW), "5m ago");
  assert.equal(relativeTime(NOW - 3 * HOUR, NOW), "3h ago");
  assert.equal(relativeTime(NOW - 3 * DAY, NOW), "3d ago");
  assert.equal(relativeTime(NOW - 8 * DAY, NOW), "last week");
  assert.equal(relativeTime(NOW - 30 * DAY, NOW), "4w ago");
  assert.equal(relativeTime(null, NOW), "");
});

test("dwellLabel says nothing about a page barely opened", () => {
  assert.equal(dwellLabel(0), "");
  assert.equal(dwellLabel(400), "");
  assert.equal(dwellLabel(45_000), "45s");
  assert.equal(dwellLabel(9 * MINUTE), "9m");
  assert.equal(dwellLabel(2 * HOUR), "2h");
});

// ---- crossings ------------------------------------------------------------

test("crossingRows excludes the trail you are already on", () => {
  const rows = crossingRows(
    [
      { node_id: 1, trail_id: 7, trail_name: "Here", created_at: NOW - HOUR },
      { node_id: 2, trail_id: 8, trail_name: "There", created_at: NOW - DAY },
    ],
    7,
    NOW
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "There");
});

test("crossingRows reports a trail once, at its earliest arrival", () => {
  const rows = crossingRows(
    [
      { node_id: 3, trail_id: 8, trail_name: "There", created_at: NOW - HOUR },
      { node_id: 2, trail_id: 8, trail_name: "There", created_at: NOW - DAY },
      { node_id: 9, trail_id: 8, trail_name: "There", created_at: NOW },
    ],
    null,
    NOW
  );
  assert.equal(rows.length, 1);
  // The node offered is the first arrival, not the latest.
  assert.equal(rows[0].nodeId, 2);
  assert.equal(rows[0].detail, "1d ago");
});

test("crossingRows names an unnamed trail for what it is", () => {
  const [row] = crossingRows(
    [{ node_id: 1, trail_id: 2, trail_name: null, created_at: NOW }],
    null,
    NOW
  );
  assert.equal(row.label, "an unnamed trail");
  assert.equal(row.named, false);
  assert.equal(row.enterable, true);
});

/**
 * @param {object} [overrides]
 * @returns {object} A `questionsFrom` row.
 */
function asked(overrides = {}) {
  return {
    id: 1,
    raw: "what is a memex",
    normalised_intent: "what is a memex",
    input_mode: "keyboard",
    created_at: NOW - DAY,
    trail_node_id: 40,
    ...overrides,
  };
}

test("questionRows reads the edge out of a page, not the edge in", () => {
  const { rows } = questionRows([asked()], { now: NOW });
  assert.equal(rows.length, 1);
  // The node offered is where the question *went*, which is the only place
  // there is to go: the page it was asked from is the one already on screen.
  assert.equal(rows[0].nodeId, 40);
  assert.equal(rows[0].label, "what is a memex");
  assert.equal(rows[0].detail, "1d ago");
  assert.equal(rows[0].enterable, true);
});

test("questionRows keeps a question the context also lists", () => {
  // Measured, not assumed: excluding these emptied the section outright under
  // one pinned enquiry, which is the case it exists for. The two sections
  // index one set of facts along the enquiry and along the page.
  const { rows, total } = questionRows(
    [
      asked({ id: 1, raw: "here too", normalised_intent: "here too" }),
      asked({ id: 2, raw: "only here", normalised_intent: "only here" }),
    ],
    { now: NOW }
  );
  assert.deepEqual(
    rows.map(row => row.label),
    ["here too", "only here"]
  );
  assert.equal(total, 2);
});

test("questionRows reports one question once, at its first asking", () => {
  const { rows } = questionRows(
    [
      asked({ id: 1, created_at: NOW - 2 * DAY }),
      asked({ id: 2, created_at: NOW - HOUR }),
    ],
    { now: NOW }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail, "2d ago");
});

test("a question answered on the second try is answered", () => {
  const { rows } = questionRows(
    [
      asked({ id: 1, created_at: NOW - 2 * DAY, trail_node_id: null }),
      asked({ id: 2, created_at: NOW - HOUR, trail_node_id: 77 }),
    ],
    { now: NOW }
  );
  assert.equal(rows.length, 1);
  // The row is still the first asking, but it is not a dead end: the landing
  // node comes from the attempt that reached one.
  assert.equal(rows[0].detail, "2d ago");
  assert.equal(rows[0].nodeId, 77);
  assert.equal(rows[0].enterable, true);
});

test("two different questions are two rows", () => {
  const { rows } = questionRows(
    [
      asked({ id: 1, raw: "a", normalised_intent: "a" }),
      asked({ id: 2, raw: "b", normalised_intent: "b" }),
    ],
    { now: NOW }
  );
  assert.equal(rows.length, 2);
});

test("questions the normaliser emptied do not collapse into one row", () => {
  const { rows } = questionRows(
    [
      asked({ id: 1, raw: "the a of", normalised_intent: "" }),
      asked({ id: 2, raw: "of the an", normalised_intent: "  " }),
    ],
    { now: NOW }
  );
  assert.equal(rows.length, 2);
});

test("a question that opened nothing is shown here too, and is not enterable", () => {
  const { rows } = questionRows([asked({ trail_node_id: null })], { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nodeId, null);
  assert.equal(rows[0].enterable, false);
});

test("the limit drops the oldest and leaves the rest in order", () => {
  const many = Array.from({ length: 5 }, (unused, i) =>
    asked({
      id: i + 1,
      raw: `q${i}`,
      normalised_intent: `q${i}`,
      created_at: NOW - (5 - i) * HOUR,
    })
  );
  const { rows, total } = questionRows(many, { limit: 3, now: NOW });
  assert.equal(total, 5);
  assert.deepEqual(
    rows.map(row => row.label),
    ["q2", "q3", "q4"]
  );
});

// ---- the whole surface ----------------------------------------------------

test("sidebarFor says what to do when there is no context", () => {
  const view = sidebarFor(null);
  assert.equal(view.sections.length, 0);
  assert.match(view.summary, /Browse or search/);
});

test("sidebarFor leads with crossings, because they are the surprise", () => {
  const view = sidebarFor(
    contents({ pages: [page()], queries: [{ id: 1, raw: "memex" }] }),
    {
      crossings: [
        { node_id: 5, trail_id: 9, trail_name: "Other", created_at: NOW - DAY },
      ],
      currentTrailId: 1,
      now: NOW,
    }
  );
  assert.equal(view.sections[0].id, "crossings");
  // The count in the note includes the trail you are on, which is why it is
  // "three trails" when two others have crossed it.
  assert.match(view.sections[0].note, /from 2 trails/);
});

test("sidebarFor omits a section it has nothing for", () => {
  const view = sidebarFor(contents({ pages: [page()] }), { now: NOW });
  assert.deepEqual(
    view.sections.map(section => section.id),
    ["pages"]
  );
});

test("sidebarFor keeps the store's page order rather than re-ranking", () => {
  const view = sidebarFor(
    contents({
      pages: [
        page({ id: 1, title: "Saved", outcome: "saved" }),
        page({ id: 2, title: "Read", outcome: "read" }),
        page({ id: 3, title: "Bounced", outcome: "bounced" }),
      ],
    }),
    { now: NOW }
  );
  assert.deepEqual(
    view.sections[0].rows.map(row => row.label),
    ["Saved", "Read", "Bounced"]
  );
});

test("a question that opened nothing is shown but is not enterable", () => {
  const view = sidebarFor(
    contents({
      queries: [
        { id: 1, raw: "answered", trail_node_id: 4, created_at: NOW },
        { id: 2, raw: "abandoned", trail_node_id: null, created_at: NOW },
      ],
    }),
    { now: NOW }
  );
  const [answered, abandoned] = view.sections[0].rows;
  assert.equal(answered.enterable, true);
  assert.equal(answered.nodeId, 4);
  assert.equal(abandoned.enterable, false);
  assert.equal(abandoned.label, "abandoned");
});

test("a dismissed page is still a row, and still enterable", () => {
  const view = sidebarFor(
    contents({ pages: [page({ dismissed_at: NOW - HOUR })] }),
    { now: NOW }
  );
  const [row] = view.sections[0].rows;
  assert.equal(row.dismissed, true);
  assert.equal(row.enterable, true);
});

test("a page with no title falls back to its host, not its URL", () => {
  const view = sidebarFor(
    contents({
      pages: [page({ title: null, url: "https://example.org/deep/path?q=1" })],
    }),
    { now: NOW }
  );
  assert.equal(view.sections[0].rows[0].label, "example.org");
});

test("a page row shows the letter its page already holds", () => {
  const view = sidebarFor(contents({ pages: [page({ id: 10 })] }), {
    marks: { markOf: id => (id === 10 ? "a" : null) },
    now: NOW,
  });
  assert.equal(view.sections[0].rows[0].mark, "a");
});

test("entities are capped and floored, and are never enterable", () => {
  const entities = Array.from({ length: 20 }, (_, i) => ({
    name: `E${i}`,
    canonical: `e${i}`,
    kind: "term",
    weight: 1,
    mentions: 2,
  }));
  entities.push({ name: "noise", kind: "term", weight: 0.2, mentions: 1 });
  const view = sidebarFor(contents({ entities }), { now: NOW });
  const rows = view.sections.find(s => s.id === "entities").rows;
  assert.equal(rows.length, 12);
  assert.ok(!rows.some(row => row.label === "noise"));
  assert.ok(rows.every(row => !row.enterable));
});

test("sidebarFor marks the page you are on", () => {
  const view = sidebarFor(
    contents({ pages: [page({ id: 1 }), page({ id: 2 })] }),
    { currentNodeId: 2, now: NOW }
  );
  const rows = view.sections[0].rows;
  assert.equal(rows[0].current, false);
  assert.equal(rows[1].current, true);
});

test("sidebarFor carries the context's mark and its spoken word", () => {
  const view = sidebarFor(contents(), { mark: "m", now: NOW });
  assert.equal(view.mark, "m");
  assert.equal(typeof view.markWord, "string");
  assert.ok(view.markWord.length);
});

test("an unnamed context is titled, not numbered", () => {
  const view = sidebarFor(contents({ context: { id: 3, label: null } }), {
    now: NOW,
  });
  assert.equal(view.title, "Unnamed context");
  assert.equal(view.named, false);
});

// ---- keyboard -------------------------------------------------------------

test("moveSelection skips rows that cannot be entered", () => {
  const rows = [
    { enterable: true },
    { enterable: false },
    { enterable: false },
    { enterable: true },
  ];
  assert.equal(moveSelection(rows, null, 1), 0);
  assert.equal(moveSelection(rows, 0, 1), 3);
  assert.equal(moveSelection(rows, 3, -1), 0);
});

test("moveSelection stops at the ends rather than wrapping", () => {
  const rows = [{ enterable: true }, { enterable: true }];
  assert.equal(moveSelection(rows, 0, -1), 0);
  assert.equal(moveSelection(rows, 1, 1), 1);
});

test("moveSelection returns null when nothing can be entered", () => {
  assert.equal(moveSelection([{ enterable: false }], null, 1), null);
});

test("moveSelection recovers when the selection is no longer enterable", () => {
  const rows = [{ enterable: true }, { enterable: false }, { enterable: true }];
  // Index 1 has gone dead under the selection: move on in the direction of
  // travel rather than jumping to an end.
  assert.equal(moveSelection(rows, 1, 1), 2);
  assert.equal(moveSelection(rows, 1, -1), 0);
});

// ---- the merge offer ------------------------------------------------------

test("sidebarFor shows no merge section without an offer", () => {
  const view = sidebarFor(contents({ pages: [page()] }), { now: NOW });
  assert.ok(!view.sections.some(section => section.id === "merge"));
});

test("the provoked section follows the crossings, and both precede the rest", () => {
  const view = sidebarFor(
    contents({
      pages: [page()],
      queries: [{ id: 1, raw: "in this context", created_at: NOW }],
    }),
    {
      crossings: [
        { node_id: 5, trail_id: 9, trail_name: "Other", created_at: NOW - DAY },
      ],
      questions: [
        asked({
          id: 2,
          raw: "asked from here",
          normalised_intent: "asked from here",
        }),
      ],
      currentTrailId: 1,
      now: NOW,
    }
  );
  assert.deepEqual(
    view.sections.map(section => section.id),
    ["crossings", "provoked", "questions", "pages"]
  );
});

test("the provoked section is absent when this page has provoked nothing", () => {
  const view = sidebarFor(contents({ pages: [page()] }), {
    questions: [],
    now: NOW,
  });
  assert.equal(
    view.sections.find(section => section.id === "provoked"),
    undefined
  );
});

test("a question the context also lists still appears against its page", () => {
  const shared = { id: 7, raw: "shared", created_at: NOW - HOUR };
  const view = sidebarFor(contents({ queries: [shared] }), {
    questions: [asked({ ...shared, normalised_intent: "shared" })],
    now: NOW,
  });
  assert.deepEqual(
    view.sections.map(section => section.id),
    ["provoked", "questions"]
  );
  assert.deepEqual(
    view.sections[0].rows.map(row => row.label),
    ["shared"]
  );
});

test("the provoked note says so when the limit has hidden some", () => {
  const many = Array.from({ length: 12 }, (unused, i) =>
    asked({
      id: i + 1,
      raw: `q${i}`,
      normalised_intent: `q${i}`,
      created_at: NOW - (12 - i) * HOUR,
    })
  );
  const view = sidebarFor(contents(), { questions: many, now: NOW });
  const section = view.sections.find(s => s.id === "provoked");
  assert.equal(section.rows.length, 8);
  assert.match(section.note, /12 questions/);
  assert.match(section.note, /8 most recent/);
});

test("the provoked note is a plain count when nothing is hidden", () => {
  const view = sidebarFor(contents(), {
    questions: [asked()],
    now: NOW,
  });
  const section = view.sections.find(s => s.id === "provoked");
  assert.match(section.note, /1 question while on this page\.$/);
  assert.doesNotMatch(section.note, /most recent/);
});

test("sidebarFor puts an offer above even the crossings", () => {
  const view = sidebarFor(contents({ pages: [page()] }), {
    crossings: [
      { node_id: 5, trail_id: 9, trail_name: "Other", created_at: NOW - DAY },
    ],
    currentTrailId: 1,
    mergeOffer: { contextId: 4, label: "Memex reading", score: 0.31 },
    now: NOW,
  });
  assert.equal(view.sections[0].id, "merge");
  assert.equal(view.sections[1].id, "crossings");
});

test("the offer names the other context and says what merging does", () => {
  const [section] = sidebarFor(contents({ pages: [page()] }), {
    mergeOffer: { contextId: 4, label: "Memex reading", score: 0.31 },
    now: NOW,
  }).sections;
  assert.match(section.note, /Memex reading/);
  assert.match(section.note, /pack/);
});

test("the offer names an unlabelled context for what it is", () => {
  const [section] = sidebarFor(contents({ pages: [page()] }), {
    mergeOffer: { contextId: 4, label: null, score: 0.31 },
    now: NOW,
  }).sections;
  assert.match(section.note, /an unnamed context/);
});

test("both answers are offered, and both carry the context to act on", () => {
  const [section] = sidebarFor(contents({ pages: [page()] }), {
    mergeOffer: { contextId: 4, label: "Memex reading", score: 0.31 },
    now: NOW,
  }).sections;
  assert.deepEqual(
    section.rows.map(row => row.action),
    ["merge-accept", "merge-decline"]
  );
  // Both have to be reachable by the one gesture the panel has.
  assert.ok(section.rows.every(row => row.enterable));
  assert.ok(section.rows.every(row => row.contextId === 4));
});

test("the decline says it is permanent rather than saying 'not now'", () => {
  const [section] = sidebarFor(contents({ pages: [page()] }), {
    mergeOffer: { contextId: 4, label: "Memex reading", score: 0.31 },
    now: NOW,
  }).sections;
  const decline = section.rows.find(row => row.action === "merge-decline");
  assert.match(decline.label, /stop asking/);
  assert.doesNotMatch(decline.label, /not now/i);
});
