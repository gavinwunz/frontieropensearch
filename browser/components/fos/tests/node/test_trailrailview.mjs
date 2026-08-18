/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the trail rail's view model.
 *
 * The three rules in the module header are decisions rather than details, so
 * each of them is asserted here as a property: the rail may not hide where you
 * are, depth is bounded by hoisting rather than truncation, and a dismissed
 * node is still a row.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import { TrailStore } from "../../FOSTrailTree.sys.mjs";
import {
  collapseTarget,
  labelFor,
  moveSelection,
  railFor,
} from "../../FOSTrailRailView.sys.mjs";

/**
 * A trail shaped like a real session: one root, a branch, and a deep leg.
 *
 *   root
 *   ├── a ── a1 ── a2
 *   └── b
 *
 * @returns {object} The store and the node ids.
 */
function seeded() {
  const store = new TrailStore({ now: (t => () => ++t)(1000) });
  const trailId = store.createTrail({ name: "Memex" });
  const root = store.addNode({ trailId, url: "https://example.org/" });
  const a = store.visit(root, { url: "https://a.example/", title: "A" });
  const a1 = store.visit(a, { url: "https://a1.example/", title: "A1" });
  const a2 = store.visit(a1, { url: "https://a2.example/", title: "A2" });
  const b = store.visit(root, { url: "https://b.example/", title: "B" });
  return { store, trailId, root, a, a1, a2, b };
}

const idsOf = rows => rows.map(r => r.id);
const depthsOf = rows => rows.map(r => r.depth);

test("rows are depth first, in navigation order, with real depths", () => {
  const { store, trailId, root, a, a1, a2, b } = seeded();
  const { rows } = railFor(store, { trailId });

  assert.deepEqual(idsOf(rows), [root, a, a1, a2, b]);
  assert.deepEqual(depthsOf(rows), [0, 1, 2, 3, 1]);
});

test("collapsing a node hides its subtree and advertises the count", () => {
  const { store, trailId, root, a, b } = seeded();
  const { rows } = railFor(store, { trailId, collapsed: new Set([a]) });

  assert.deepEqual(idsOf(rows), [root, a, b]);
  const collapsed = rows.find(r => r.id === a);
  assert.equal(collapsed.collapsed, true);
  assert.equal(collapsed.childCount, 1);
});

test("collapse never hides the current node — rule 1", () => {
  const { store, trailId, root, a, a1, a2, b } = seeded();
  // The user collapsed the whole `a` leg, then re-entered a node inside it.
  const { rows } = railFor(store, {
    trailId,
    currentId: a2,
    collapsed: new Set([root, a, a1]),
  });

  assert.deepEqual(
    idsOf(rows),
    [root, a, a1, a2, b],
    "every ancestor of the current node is force-opened"
  );
  assert.equal(
    rows.find(r => r.id === a).collapsed,
    false,
    "an ancestor of the current node renders open"
  );
  assert.equal(
    rows.find(r => r.id === a2).isCurrent,
    true,
    "and the current node is actually reachable in the rail"
  );
});

test("the stored collapse state survives being overridden", () => {
  const { store, trailId, root, a, b, a2 } = seeded();
  const collapsed = new Set([a]);

  railFor(store, { trailId, currentId: a2, collapsed });
  // Overriding is a render-time decision; the user's state is not edited.
  assert.deepEqual([...collapsed], [a]);

  const { rows } = railFor(store, { trailId, currentId: b, collapsed });
  assert.deepEqual(
    idsOf(rows),
    [root, a, b],
    "moving off the leg lets the collapse take effect again"
  );
});

test("collapsing the current node hides its forward branches", () => {
  const { store, trailId, root, a, b } = seeded();
  const { rows } = railFor(store, {
    trailId,
    currentId: a,
    collapsed: new Set([a]),
  });

  assert.deepEqual(
    idsOf(rows),
    [root, a, b],
    "the node you are on may be collapsed; only its ancestors may not"
  );
});

test("hoisting re-roots the rail and leaves a breadcrumb — rule 2", () => {
  const { store, trailId, root, a, a1, a2 } = seeded();
  const { rows, breadcrumb } = railFor(store, { trailId, hoistRoot: a1 });

  assert.deepEqual(idsOf(rows), [a1, a2]);
  assert.deepEqual(
    depthsOf(rows),
    [0, 1],
    "depth is relative to the hoist root, which is what buys back the indent"
  );
  assert.deepEqual(
    breadcrumb.map(c => c.id),
    [root, a],
    "the ancestors are the way back out"
  );
  assert.equal(rows[0].isHoistRoot, true);
});

test("hoisting to a node of another trail is refused", () => {
  const { store, trailId, a } = seeded();
  const other = store.createTrail();
  assert.throws(() => railFor(store, { trailId: other, hoistRoot: a }), /hoist/);
});

test("a dismissed node is still a row — rule 3", () => {
  const { store, trailId, a1 } = seeded();
  store.dismiss(a1);
  const { rows } = railFor(store, { trailId });

  const row = rows.find(r => r.id === a1);
  assert.ok(row, "dismissal does not remove the node from the rail");
  assert.equal(row.dismissed, true);
});

test("the spine from root to current is marked", () => {
  const { store, trailId, root, a, a1, a2, b } = seeded();
  const { rows } = railFor(store, { trailId, currentId: a1 });

  const spine = rows.filter(r => r.onSpine).map(r => r.id);
  assert.deepEqual(spine, [root, a, a1]);
  assert.equal(rows.find(r => r.id === a2).onSpine, false);
  assert.equal(rows.find(r => r.id === b).onSpine, false);
});

test("marks and their spoken forms are read through, never assigned", () => {
  const { store, trailId, root } = seeded();
  const { rows } = railFor(store, {
    trailId,
    marks: { markOf: id => (id === root ? "c" : null) },
  });

  assert.equal(rows[0].mark, "c");
  assert.equal(rows[0].spoken, "cap", "the word is what a voice user says");
  assert.equal(rows[1].mark, null);
  assert.equal(rows[1].spoken, null);
});

test("labels prefer the title, then the host, then the raw url", () => {
  assert.equal(labelFor({ title: "A", url: "https://a.example/x" }), "A");
  assert.equal(
    labelFor({ title: null, url: "https://a.example/docs?q=1" }),
    "a.example/docs",
    "a query string is noise at rail width"
  );
  assert.equal(labelFor({ title: null, url: "https://a.example/" }), "a.example");
  assert.equal(labelFor({ title: null, url: "not a url" }), "not a url");
});

test("selection moves over rendered rows and clamps at the ends", () => {
  const { store, trailId, root, a, b } = seeded();
  const { rows } = railFor(store, { trailId, collapsed: new Set([a]) });

  assert.equal(moveSelection(rows, root, 1), a);
  assert.equal(
    moveSelection(rows, a, 1),
    b,
    "a collapsed subtree is stepped past in one keypress"
  );
  assert.equal(moveSelection(rows, root, -1), root, "clamps at the top");
  assert.equal(moveSelection(rows, b, 1), b, "clamps at the bottom");
  assert.equal(moveSelection(rows, null, 1), root, "no selection starts at top");
  assert.equal(moveSelection([], root, 1), null);
});

test("collapse acts on the node, then on its parent", () => {
  const { store, trailId, root, a, a1, a2 } = seeded();
  const collapsed = new Set();
  const { rows } = railFor(store, { trailId });

  assert.deepEqual(
    collapseTarget(store, rows, a, collapsed),
    { collapse: a, select: a },
    "an expanded parent collapses itself"
  );
  assert.deepEqual(
    collapseTarget(store, rows, a2, collapsed),
    { collapse: a1, select: a1 },
    "a leaf walks out to its parent instead of doing nothing"
  );
  assert.equal(
    collapseTarget(store, rows, root, collapsed).collapse,
    root,
    "a root with children still collapses"
  );
  assert.equal(
    collapseTarget(store, railFor(store, { trailId, hoistRoot: a1 }).rows, a1, collapsed)
      .collapse,
    a1,
    "and inside a hoist, collapse never escapes the visible rows"
  );
});

test("collapse walks no further than the rendered rows", () => {
  const { store, trailId, a1, a2 } = seeded();
  const rows = railFor(store, { trailId, hoistRoot: a1 }).rows;
  // a2's parent a1 is the hoist root and is rendered, so this is fine; but its
  // grandparent is not, and collapsing must not select something invisible.
  const target = collapseTarget(store, rows, a2, new Set());
  assert.equal(target.select, a1);
  assert.equal(
    collapseTarget(store, rows, a1, new Set([a1])),
    null,
    "there is nowhere above the hoist root to go"
  );
});
