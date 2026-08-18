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
