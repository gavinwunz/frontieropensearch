/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The Context Engine's store, against real SQLite.
 *
 * Node cannot reach any of this: the migration is a packaged chrome resource,
 * the constraints are enforced by SQLite rather than by JavaScript, and the
 * queries behind `what` and `pack` are the part most likely to be quietly
 * wrong. Every check here is one the pure tests cannot make.
 */

const { FOSContextStore, SCHEMA_VERSION } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextStore.sys.mjs"
);
const { extractEntities } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextSignals.sys.mjs"
);
const { buildContextPack } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextPack.sys.mjs"
);

// The store opens a file in the profile, so xpcshell needs a real one.
do_get_profile();

let counter = 0;

/**
 * A store on its own scratch database.
 *
 * @returns {Promise<object>} An open `FOSContextStore`.
 */
async function freshStore() {
  const path = PathUtils.join(
    PathUtils.profileDir,
    `context-engine-test-${counter++}.sqlite`
  );
  await IOUtils.remove(path, { ignoreAbsent: true });
  return FOSContextStore.open({ path });
}

add_task(async function test_migration_applies_and_is_idempotent() {
  const path = PathUtils.join(
    PathUtils.profileDir,
    "context-engine-migration.sqlite"
  );
  await IOUtils.remove(path, { ignoreAbsent: true });

  let store = await FOSContextStore.open({ path });
  Assert.equal(
    await store.connection.getSchemaVersion(),
    SCHEMA_VERSION,
    "the database is at the version this build expects"
  );
  for (const table of [
    "trail",
    "trail_node",
    "query",
    "visit",
    "entity",
    "entity_mention",
    "context",
    "context_member",
    "embedding",
    "field_placement",
  ]) {
    Assert.ok(await store.connection.tableExists(table), `${table} exists`);
  }
  await store.close();

  // Reopening must not try to apply the migration a second time. If it did,
  // CREATE TABLE would throw and the store would be unopenable from the second
  // launch onwards — which is exactly the bug a version check exists to stop
  // and exactly the one that would never show up on a developer's first run.
  store = await FOSContextStore.open({ path });
  Assert.equal(await store.connection.getSchemaVersion(), SCHEMA_VERSION);
  await store.close();
});

add_task(async function test_a_branch_survives_going_back() {
  // Pillar B's promise, asserted against the durable record rather than the
  // in-memory tree: nothing about recording a second child removes the first.
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "memex" });
  const root = await store.addNode({ trailId, url: "https://example.org/" });
  const first = await store.addNode({
    trailId,
    parentId: root,
    url: "https://example.org/a",
  });
  const second = await store.addNode({
    trailId,
    parentId: root,
    url: "https://example.org/b",
  });

  const rows = await store.connection.execute(
    "SELECT id FROM trail_node WHERE parent_id = :root ORDER BY id",
    { root }
  );
  Assert.deepEqual(
    rows.map(row => row.getResultByName("id")),
    [first, second],
    "both branches are on the tree"
  );
  await store.close();
});

add_task(async function test_dismissal_is_lossless() {
  const store = await freshStore();
  const trailId = await store.addTrail();
  const node = await store.addNode({ trailId, url: "https://example.org/x" });
  await store.updateNode(node, { scrollX: 0, scrollY: 4200 });
  await store.dismissNode(node, 12345);

  const [row] = await store.connection.execute(
    "SELECT scroll_y, dismissed_at FROM trail_node WHERE id = :id",
    { id: node }
  );
  Assert.equal(row.getResultByName("dismissed_at"), 12345, "dismissal is soft");
  Assert.equal(
    row.getResultByName("scroll_y"),
    4200,
    "the scroll offset survives dismissal, so re-entry is lossless"
  );
  await store.close();
});

add_task(async function test_trail_crossings() {
  // The memex's compounding effect: one document on many trails. No schema
  // change was needed because a node is a visit, not a document.
  const store = await freshStore();
  const one = await store.addTrail({ name: "memex" });
  const two = await store.addTrail({ name: "hypertext" });
  await store.addNode({ trailId: one, url: "https://example.org/bush" });
  await store.addNode({ trailId: two, url: "https://example.org/bush" });
  await store.addNode({ trailId: two, url: "https://example.org/other" });

  const crossings = await store.crossings("https://example.org/bush");
  Assert.equal(crossings.length, 2, "the page was reached from two trails");
  Assert.deepEqual(
    crossings.map(crossing => crossing.trail_name).sort(),
    ["hypertext", "memex"],
    "and the store can say which"
  );
  await store.close();
});

add_task(async function test_entities_dedupe_across_records() {
  const store = await freshStore();
  const trailId = await store.addTrail();
  const node = await store.addNode({
    trailId,
    url: "https://example.org/",
    title: "As We May Think",
  });
  const queryId = await store.recordQuery({ raw: "as we may think" });

  await store.recordEntities(extractEntities("As We May Think"), {
    nodeId: node,
  });
  await store.recordEntities(extractEntities("As We May Think"), { queryId });

  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS entities,
            (SELECT COUNT(*) FROM entity_mention) AS mentions
     FROM entity WHERE canonical = 'as we may think'`
  );
  Assert.equal(row.getResultByName("entities"), 1, "one entity row");
  Assert.equal(
    row.getResultByName("mentions"),
    2,
    "two mentions, which is what makes a mention count mean anything"
  );
  await store.close();
});

add_task(async function test_a_mention_must_hang_off_exactly_one_record() {
  const store = await freshStore();
  await Assert.rejects(
    store.recordEntities(
      [{ name: "x", canonical: "x", kind: "term", weight: 1 }],
      {}
    ),
    /exactly one/,
    "neither is refused"
  );
  await store.close();
});

add_task(async function test_membership_is_idempotent() {
  // The tree is reconciled by walking it, so the same node is offered to the
  // same context repeatedly. A duplicate row would inflate every count the
  // sidebar and the pack report.
  const store = await freshStore();
  const trailId = await store.addTrail();
  const node = await store.addNode({ trailId, url: "https://example.org/" });
  const contextId = await store.addContext({ label: "memex" });
  await store.addMember(contextId, { nodeId: node, source: "provenance" });
  await store.addMember(contextId, { nodeId: node, source: "provenance" });

  const [row] = await store.connection.execute(
    "SELECT COUNT(*) AS n FROM context_member WHERE context_id = :id",
    { id: contextId }
  );
  Assert.equal(row.getResultByName("n"), 1, "one membership, not two");
  await store.close();
});

add_task(async function test_outcome_is_the_best_a_page_achieved() {
  // Reading a page and later bouncing off it does not un-read it.
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "memex" });
  const node = await store.addNode({
    trailId,
    url: "https://example.org/bush",
    title: "As We May Think",
  });
  const contextId = await store.addContext({ label: "memex" });
  await store.addMember(contextId, { nodeId: node, source: "provenance" });

  const first = await store.startVisit(node, 1000);
  await store.endVisit(first, { dwellMs: 240_000, outcome: "read" });
  const second = await store.startVisit(node, 2000);
  await store.endVisit(second, { dwellMs: 900, outcome: "bounced" });

  const contents = await store.contextContents(contextId);
  Assert.equal(contents.pages.length, 1, "one page, not one row per visit");
  Assert.equal(contents.pages[0].outcome, "read", "the best outcome stands");
  Assert.equal(contents.pages[0].dwell_ms, 240_000, "and the longest dwell");
  await store.close();
});

add_task(async function test_context_contents_feeds_the_pack() {
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "memex" });
  const contextId = await store.addContext({ label: "memex" });

  const node = await store.addNode({
    trailId,
    url: "https://example.org/bush",
    title: "As We May Think",
  });
  const queryId = await store.recordQuery({
    raw: "what is a memex",
    normalisedIntent: "memex",
    trailNodeId: node,
    inputMode: "voice",
  });
  await store.addMember(contextId, { nodeId: node, source: "provenance" });
  await store.addMember(contextId, { queryId, source: "provenance" });
  await store.recordEntities(extractEntities("As We May Think"), {
    nodeId: node,
  });
  const visit = await store.startVisit(node, 1000);
  await store.endVisit(visit, { dwellMs: 60_000, outcome: "read" });

  const contents = await store.contextContents(contextId);
  Assert.equal(contents.context.label, "memex");
  Assert.equal(contents.queries.length, 1);
  Assert.equal(contents.queries[0].input_mode, "voice");
  Assert.equal(contents.pages.length, 1);
  Assert.ok(contents.entities.length, "entities are reachable through members");

  // The pack is a pure function, but this is the first time it has been handed
  // rows SQLite actually produced rather than rows a test author wrote.
  const pack = buildContextPack(contents, { now: 0 });
  Assert.ok(pack.includes("what is a memex"), "the question is in the brief");
  Assert.ok(pack.includes("### Read"), "the page is grouped by its outcome");
  Assert.ok(pack.includes("As We May Think"), "the page is named");
  Assert.ok(
    pack.includes("_(spoken)_"),
    "the modality survived the round trip"
  );

  await store.close();
});

add_task(async function test_a_human_placement_is_never_overwritten() {
  // `moved_by_user_at` is the whole reason the table exists: an auto-placed
  // card says nothing about what the user thinks, and a later automatic write
  // must not erase the moment they said otherwise.
  const store = await freshStore();
  const trailId = await store.addTrail();
  const node = await store.addNode({ trailId, url: "https://example.org/" });

  await store.placeCard(node, { x: 1, y: 1 });
  await store.placeCard(node, { x: 2, y: 2, pinned: true, movedByUserAt: 999 });
  await store.placeCard(node, { x: 3, y: 3 });

  const [row] = await store.connection.execute(
    "SELECT x, moved_by_user_at FROM field_placement WHERE trail_node_id = :id",
    { id: node }
  );
  Assert.equal(row.getResultByName("x"), 3, "the position tracks the card");
  Assert.equal(
    row.getResultByName("moved_by_user_at"),
    999,
    "but the evidence that a human placed it is kept"
  );
  await store.close();
});

add_task(async function test_the_active_context_is_the_one_last_worked_in() {
  const store = await freshStore();
  const first = await store.addContext({ label: "one", now: 1000 });
  const second = await store.addContext({ label: "two", now: 2000 });
  Assert.equal((await store.activeContext()).id, second);

  await store.touchContext(first, 3000);
  Assert.equal(
    (await store.activeContext()).id,
    first,
    "switching back makes it active again"
  );

  const all = await store.contexts();
  Assert.equal(all.length, 2);
  Assert.equal(all[0].id, first, "contexts list most recently active first");
  await store.close();
});
