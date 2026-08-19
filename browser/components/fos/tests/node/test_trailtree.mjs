/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the trail tree.
 *
 * The first test is pillar B's whole promise and should be read as the
 * acceptance criterion the rest of the file supports.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import { TrailStore } from "../../FOSTrailTree.sys.mjs";

/**
 * A monotonic clock, so timestamps are assertable rather than wall-clock.
 *
 * @param {number} start First tick the clock returns.
 */
function fixedClock(start = 1000) {
  let t = start;
  return () => ++t;
}

function seeded() {
  const store = new TrailStore({ now: fixedClock() });
  const trailId = store.createTrail();
  const root = store.addNode({
    trailId,
    url: "https://example.invalid/search",
    title: "search",
  });
  return { store, trailId, root };
}

test("going back and navigating again never destroys the forward branch", () => {
  // The replacement for linear history, stated as a property. In a list, the
  // second navigation from `root` overwrites the first; here it cannot, because
  // there is no code path that removes a node on navigation.
  const { store, root } = seeded();

  const first = store.visit(root, {
    url: "https://example.invalid/a",
    title: "a",
  });
  const deep = store.visit(first, {
    url: "https://example.invalid/a/deep",
    title: "deep",
  });

  // Back to the root, then off in another direction.
  const second = store.visit(root, {
    url: "https://example.invalid/b",
    title: "b",
  });

  assert.deepEqual(
    store.children(root).map(n => n.title),
    ["a", "b"],
    "both directions survive as siblings"
  );
  assert.deepEqual(
    store.siblings(second).map(n => n.id),
    [first]
  );
  assert.deepEqual(
    store.path(deep).map(n => n.title),
    ["search", "a", "deep"],
    "the abandoned branch is still whole and still reachable"
  );
  assert.equal(store.getNode(deep).dismissed_at, null);
});

test("branch starts a sibling, visit starts a child", () => {
  const { store, root } = seeded();
  const child = store.visit(root, { url: "u1" });
  const sibling = store.branch(child, { url: "u2" });

  assert.equal(store.getNode(sibling).parent_id, root);
  assert.deepEqual(
    store.children(root).map(n => n.id),
    [child, sibling]
  );

  // A root's sibling is another root, not an orphan.
  const otherRoot = store.branch(root, { url: "u3" });
  assert.equal(store.getNode(otherRoot).parent_id, null);
  assert.equal(store.roots(store.getNode(root).trail_id).length, 2);
});

test("dismissal removes a card from the Field, not the page from the trail", () => {
  const { store, root } = seeded();
  const node = store.visit(root, {
    url: "https://example.invalid/long",
    title: "long",
  });
  store.setViewState(node, { scrollX: 0, scrollY: 4200, formState: "blob" });

  store.dismiss(node);
  const dismissed = store.getNode(node);
  assert.ok(dismissed.dismissed_at, "marked dismissed");
  assert.equal(dismissed.scroll_y, 4200, "scroll survives dismissal");
  assert.equal(
    dismissed.form_state,
    "blob",
    "in-page state survives dismissal"
  );
  assert.deepEqual(
    store.path(node).map(n => n.title),
    ["search", "long"],
    "still on its trail"
  );

  store.restore(node);
  assert.equal(store.getNode(node).dismissed_at, null);
  assert.equal(
    store.getNode(node).scroll_y,
    4200,
    "restored where it was left"
  );
});

test("graft moves a node and its subtree", () => {
  const { store, root } = seeded();
  const a = store.visit(root, { url: "a" });
  const b = store.visit(root, { url: "b" });
  const under = store.visit(a, { url: "a/1" });
  const deeper = store.visit(under, { url: "a/1/1" });

  store.graft(under, b);

  assert.equal(store.getNode(under).parent_id, b);
  assert.deepEqual(
    store.children(a).map(n => n.id),
    [],
    "detached from the old parent"
  );
  assert.deepEqual(
    store.children(b).map(n => n.id),
    [under]
  );
  assert.deepEqual(
    store.path(deeper).map(n => n.url),
    ["https://example.invalid/search", "b", "a/1", "a/1/1"],
    "the subtree came along"
  );

  store.graft(under, null);
  assert.equal(
    store.getNode(under).parent_id,
    null,
    "grafting to null makes a root"
  );
});

test("graft refuses the moves that would corrupt the tree", () => {
  const { store, trailId, root } = seeded();
  const a = store.visit(root, { url: "a" });
  const under = store.visit(a, { url: "a/1" });

  assert.throws(() => store.graft(a, a), /own parent/);
  assert.throws(() => store.graft(a, under), /own subtree/);

  const otherTrail = store.createTrail({ name: "elsewhere" });
  const foreign = store.addNode({ trailId: otherTrail, url: "x" });
  assert.throws(() => store.graft(a, foreign), /across trails/);
  assert.throws(
    () => store.addNode({ trailId, parentId: foreign, url: "y" }),
    /across trails/
  );
  assert.throws(() => store.graft(a, 9999), /no such node/);
});

test("a trail is named, and naming is what makes it first-class", () => {
  const store = new TrailStore({ now: fixedClock() });
  const id = store.createTrail();
  assert.equal(
    store.getTrail(id).name,
    null,
    "null until named, per the schema"
  );
  const before = store.getTrail(id).updated_at;
  store.nameTrail(id, "gecko session history");
  assert.equal(store.getTrail(id).name, "gecko session history");
  assert.ok(store.getTrail(id).updated_at > before);
  assert.throws(() => store.nameTrail(9999, "x"), /no such trail/);
});

test("promotion copies a curated selection and leaves the capture intact", () => {
  // Capture is automatic and total; a Trail is something the user made. If
  // promotion moved nodes it would edit the record of what actually happened,
  // which is the distinction this model exists to hold.
  const { store, trailId, root } = seeded();
  const a = store.visit(root, { url: "a", title: "a" });
  const noise = store.visit(root, { url: "noise", title: "noise" });
  const keep = store.visit(a, { url: "a/1", title: "a/1" });
  store.setViewState(keep, { scrollY: 120 });

  const capturedBefore = store.nodes(trailId).length;
  const { trailId: promoted, idMap } = store.promote([root, a, keep], {
    name: "gecko",
  });

  assert.equal(store.getTrail(promoted).name, "gecko");
  assert.equal(
    store.nodes(trailId).length,
    capturedBefore,
    "capture is untouched"
  );
  assert.ok(store.getNode(noise), "unselected nodes are not disturbed");

  const copies = store.nodes(promoted);
  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map(n => n.title).sort(), ["a", "a/1", "search"]);
  assert.equal(
    store.getNode(idMap.get(keep)).scroll_y,
    120,
    "view state comes along"
  );
  assert.deepEqual(
    store.path(idMap.get(keep)).map(n => n.title),
    ["search", "a", "a/1"],
    "structure is preserved among the selected nodes"
  );
  assert.notEqual(idMap.get(root), root, "the copy is a distinct node");
});

test("a selection with gaps flattens rather than failing", () => {
  const { store, root } = seeded();
  const a = store.visit(root, { url: "a", title: "a" });
  const deep = store.visit(a, { url: "a/1", title: "a/1" });

  // `a` is skipped, so its child cannot keep its parent.
  const { trailId: promoted, idMap } = store.promote([root, deep]);
  assert.equal(store.getNode(idMap.get(deep)).parent_id, null);
  assert.equal(store.roots(promoted).length, 2);
  assert.throws(() => store.promote([]), /empty selection/);
  assert.throws(() => store.promote([9999]), /no such node/);
});

test("a trail exports to JSON and comes back identical", () => {
  // Pillar B requires trails be exportable. Round-tripping is the cheap check
  // that the export is complete rather than merely readable.
  const { store, trailId, root } = seeded();
  const a = store.visit(root, { url: "a", title: "a" });
  store.visit(a, { url: "a/1", title: "a/1" });
  const b = store.branch(a, { url: "b", title: "b" });
  store.setViewState(b, { scrollX: 5, scrollY: 6, formState: "blob" });
  store.dismiss(b);
  store.nameTrail(trailId, "gecko");

  const exported = store.toJSON(trailId);
  const reloaded = TrailStore.fromJSON(JSON.parse(JSON.stringify(exported)));

  assert.deepEqual(reloaded.toJSON(trailId), exported);
  assert.deepEqual(
    reloaded.children(a).map(n => n.url),
    store.children(a).map(n => n.url),
    "parent links are rebuilt, not just the rows"
  );
  assert.equal(reloaded.getNode(b).form_state, "blob");
  assert.equal(reloaded.getTrail(trailId).name, "gecko");

  // Ids must not be reissued over the top of imported ones.
  const fresh = reloaded.addNode({ trailId, url: "new" });
  assert.equal(reloaded.getNode(fresh).url, "new");
  assert.equal(store.getNode(fresh), null);
});

test("a full export carries every trail", () => {
  const { store, trailId, root } = seeded();
  store.visit(root, { url: "a" });
  const second = store.createTrail({ name: "other" });
  store.addNode({ trailId: second, url: "z" });

  const all = store.toJSON();
  assert.equal(all.trails.length, 2);
  assert.equal(all.nodes.length, 3);
  const reloaded = TrailStore.fromJSON(all);
  assert.equal(reloaded.nodes(trailId).length, 2);
  assert.equal(reloaded.nodes(second).length, 1);
  assert.throws(() => TrailStore.fromJSON({ version: 99 }), /unsupported/);
  assert.throws(() => TrailStore.fromJSON(null), /unsupported/);
});

test("an export with a dangling parent is rejected, not half-loaded", () => {
  assert.throws(
    () =>
      TrailStore.fromJSON({
        version: 1,
        trails: [
          {
            id: 1,
            name: null,
            created_at: 1,
            updated_at: 1,
            archived_at: null,
          },
        ],
        nodes: [
          {
            id: 1,
            trail_id: 1,
            parent_id: 42,
            url: "a",
            title: null,
            scroll_x: 0,
            scroll_y: 0,
            form_state: null,
            created_at: 1,
            last_visited_at: 1,
            dismissed_at: null,
          },
        ],
      }),
    /missing parent/
  );
});

test("hydration brings a tree back with its ids intact", () => {
  const { store, trailId, root } = seeded();
  const child = store.visit(root, { url: "b", title: "B" });
  store.setViewState(child, { scrollY: 640, formState: '{"entry":{}}' });
  const exported = store.toJSON();

  const restored = new TrailStore({ now: fixedClock() });
  const ids = restored.hydrate(exported);

  assert.equal(ids.nodes.get(child), child, "a node keeps its id");
  assert.equal(ids.trails.get(trailId), trailId);
  assert.deepEqual(restored.getNode(child), store.getNode(child));
  assert.equal(restored.children(root).length, 1, "and its shape");
  assert.equal(
    restored.getNode(child).form_state,
    '{"entry":{}}',
    "the blob that makes re-entry lossless survives the round trip"
  );
});

test("a node minted after hydration cannot collide with a restored one", () => {
  const restored = new TrailStore({ now: fixedClock() });
  restored.hydrate({
    trails: [{ id: 7, name: null, created_at: 1, updated_at: 1 }],
    nodes: [{ id: 40, trail_id: 7, parent_id: null, url: "a", created_at: 1 }],
  });

  const trail = restored.createTrail();
  const node = restored.addNode({ trailId: trail, url: "b" });
  assert.ok(trail > 7, "trail ids continue past the highest restored one");
  assert.ok(node > 40, "and so do node ids");
  assert.equal(restored.getNode(40).url, "a", "the restored node is untouched");
});

test("hydration takes records in any order, not in id order", () => {
  // `graft` can put a node under a parent created after it, so ordering by id
  // is not a topological order and a single pass would drop the child.
  const restored = new TrailStore({ now: fixedClock() });
  restored.hydrate({
    trails: [{ id: 1, name: null, created_at: 1, updated_at: 1 }],
    nodes: [
      { id: 2, trail_id: 1, parent_id: 3, url: "child", created_at: 2 },
      { id: 3, trail_id: 1, parent_id: null, url: "parent", created_at: 3 },
    ],
  });
  assert.deepEqual(
    restored.children(3).map(n => n.id),
    [2]
  );
});

test("a refused set leaves the store empty, not half loaded", () => {
  const restored = new TrailStore({ now: fixedClock() });
  assert.throws(
    () =>
      restored.hydrate({
        trails: [{ id: 1, name: null, created_at: 1, updated_at: 1 }],
        nodes: [
          { id: 1, trail_id: 1, parent_id: null, url: "a", created_at: 1 },
          { id: 2, trail_id: 1, parent_id: 99, url: "b", created_at: 1 },
        ],
      }),
    /missing parent/
  );
  assert.equal(restored.trails().length, 0, "nothing was written");
  assert.equal(restored.nodes().length, 0);
});

test("a node whose trail did not come back is refused", () => {
  const restored = new TrailStore({ now: fixedClock() });
  assert.throws(
    () =>
      restored.hydrate({
        trails: [],
        nodes: [
          { id: 1, trail_id: 5, parent_id: null, url: "a", created_at: 1 },
        ],
      }),
    /missing trail/
  );
});

test("hydrating a store that already has a tree is a programming error", () => {
  const { store } = seeded();
  assert.throws(() => store.hydrate({ trails: [], nodes: [] }), /empty store/);
});

test("a restored trail is still an ordinary trail", () => {
  const restored = new TrailStore({ now: fixedClock() });
  restored.hydrate({
    trails: [{ id: 1, name: null, created_at: 1, updated_at: 1 }],
    nodes: [{ id: 1, trail_id: 1, parent_id: null, url: "a", created_at: 1 }],
  });

  // The point of restoring is that yesterday's work can be continued, so every
  // verb has to reach a restored node exactly as it reaches a fresh one.
  const child = restored.visit(1, { url: "b" });
  assert.equal(restored.getNode(child).parent_id, 1);
  restored.nameTrail(1, "yesterday");
  assert.equal(restored.getTrail(1).name, "yesterday");
  assert.equal(restored.path(child).length, 2, "and the spine is walkable");
});

// -------------------------------------------------------------- `done`

test("archiving stamps the trail and nothing else", () => {
  const store = new TrailStore({ now: fixedClock() });
  const trailId = store.createTrail({ name: "reading" });
  const root = store.addNode({ trailId, url: "https://a.invalid/" });
  const child = store.visit(root, { url: "https://b.invalid/" });

  assert.equal(store.isArchived(trailId), false);
  const trail = store.archiveTrail(trailId);

  assert.ok(trail.archived_at > 0);
  assert.equal(store.isArchived(trailId), true);
  assert.equal(trail.name, "reading", "the trail keeps its name");
  assert.equal(
    store.nodes(trailId).length,
    2,
    "and every page it holds, because this is not a delete"
  );
  assert.equal(store.getNode(child).parent_id, root, "the tree is intact");
});

test("archiving twice keeps the first timestamp", () => {
  const store = new TrailStore({ now: fixedClock() });
  const trailId = store.createTrail();
  store.addNode({ trailId, url: "https://a.invalid/" });

  const first = store.archiveTrail(trailId).archived_at;
  assert.equal(
    store.archiveTrail(trailId).archived_at,
    first,
    "when a trail was finished is a fact about the first time it was said"
  );
});

test("archiving an unknown trail throws, like every other id in this file", () => {
  const store = new TrailStore({ now: fixedClock() });
  assert.throws(() => store.archiveTrail(9999), /no such trail/);
  assert.equal(store.isArchived(9999), false);
});

test("an archived trail survives a hydrate round trip", () => {
  const store = new TrailStore({ now: fixedClock() });
  const trailId = store.createTrail();
  store.addNode({ trailId, url: "https://a.invalid/" });
  store.archiveTrail(trailId);

  const revived = new TrailStore({ now: fixedClock() });
  revived.hydrate({ trails: store.trails(), nodes: store.nodes() });

  assert.equal(
    revived.isArchived(trailId),
    true,
    "or the verb would last exactly one session"
  );
});
