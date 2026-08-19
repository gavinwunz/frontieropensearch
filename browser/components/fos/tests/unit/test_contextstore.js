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

add_task(async function test_questions_asked_from_a_page() {
  // The other direction of the same edge as `crossings`, and the reader
  // `query.source_node_id` went without from 001 until now.
  const store = await freshStore();
  const one = await store.addTrail({ name: "memex" });
  const two = await store.addTrail({ name: "hypertext" });
  // The same document, visited on two trails — which is what makes the URL and
  // not the node the right key.
  const here = await store.addNode({
    trailId: one,
    url: "https://example.org/bush",
  });
  const again = await store.addNode({
    trailId: two,
    url: "https://example.org/bush",
  });
  const elsewhere = await store.addNode({
    trailId: two,
    url: "https://example.org/other",
  });
  const landed = await store.addNode({
    trailId: one,
    url: "https://example.org/trails",
  });

  await store.recordQuery({
    raw: "associative trails",
    sourceNodeId: here,
    trailNodeId: landed,
    now: 1000,
  });
  await store.recordQuery({
    raw: "who was vannevar bush",
    sourceNodeId: again,
    now: 2000,
  });
  await store.recordQuery({
    raw: "xanadu",
    sourceNodeId: elsewhere,
    now: 3000,
  });
  await store.recordQuery({ raw: "typed from nowhere", now: 4000 });

  const questions = await store.questionsFrom("https://example.org/bush");
  Assert.deepEqual(
    questions.map(query => query.raw),
    ["associative trails", "who was vannevar bush"],
    "both visits to the document answer, and nothing else does"
  );
  Assert.equal(
    questions[0].trail_node_id,
    landed,
    "a question carries the page it opened, which is where its row goes"
  );
  Assert.equal(
    questions[1].trail_node_id,
    null,
    "and a question that opened nothing says so rather than being dropped"
  );

  Assert.deepEqual(
    (await store.questionsFrom("https://example.org/trails")).map(q => q.raw),
    [],
    "the page a question landed on is not the page it was asked from"
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

add_task(async function test_only_positions_a_human_chose_are_read_back() {
  // The reader half of the same column. Seeding is deterministic, so an
  // auto-placed card reproduces its own position on the next start and a row
  // for it would carry no information; a position somebody chose is the only
  // thing here that cannot be recomputed. See IDEAS.md run 42.
  const store = await freshStore();
  const trailId = await store.addTrail();
  const auto = await store.addNode({ trailId, url: "https://example.org/a" });
  const chosen = await store.addNode({ trailId, url: "https://example.org/b" });
  const untouched = await store.addNode({
    trailId,
    url: "https://example.org/c",
  });

  await store.placeCard(auto, { x: 1, y: 1 });
  await store.placeCard(chosen, {
    x: 7,
    y: 9,
    pinned: true,
    movedByUserAt: 42,
  });

  const saved = await store.placements([auto, chosen, untouched]);
  Assert.equal(saved.size, 1, "an auto placement is not a placement");
  Assert.deepEqual(
    saved.get(chosen),
    { x: 7, y: 9 },
    "and the one the user made comes back whole"
  );

  Assert.equal(
    (await store.placements([])).size,
    0,
    "asking about no nodes reads nothing rather than everything"
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

add_task(async function test_restoring_returns_the_most_recent_trails() {
  const store = await freshStore();
  const older = await store.addTrail({ name: "older", now: 1000 });
  const newer = await store.addTrail({ name: "newer", now: 2000 });
  const empty = await store.addTrail({ now: 3000 });
  for (const trailId of [older, newer]) {
    await store.addNode({ trailId, url: `https://example.invalid/${trailId}` });
  }

  const { trails, nodes } = await store.restorable();
  Assert.deepEqual(
    trails.map(t => t.id),
    [newer, older],
    "most recently worked in first"
  );
  Assert.ok(
    !trails.some(t => t.id === empty),
    "a trail with no nodes is not worth a region on the Field"
  );
  Assert.equal(nodes.length, 2, "and every node of the trails that did return");
  Assert.equal(
    trails[0].node_count,
    undefined,
    "the count was the budget's business, not the caller's"
  );

  const capped = await store.restorable({ trailLimit: 1 });
  Assert.deepEqual(
    capped.trails.map(t => t.id),
    [newer]
  );
  await store.close();
});

add_task(async function test_a_trail_comes_back_whole_or_not_at_all() {
  const store = await freshStore();
  const big = await store.addTrail({ now: 2000 });
  for (let i = 0; i < 4; i++) {
    await store.addNode({ trailId: big, url: `https://example.invalid/${i}` });
  }
  const small = await store.addTrail({ now: 1000 });
  await store.addNode({ trailId: small, url: "https://example.invalid/small" });

  // Three is not enough for the newer trail. Truncating it would draw a tree
  // the user never browsed, so the budget passes over it and spends what it
  // has on the one that fits.
  const { trails, nodes } = await store.restorable({ nodeLimit: 3 });
  Assert.deepEqual(
    trails.map(t => t.id),
    [small],
    "a trail over budget is skipped rather than cut down"
  );
  Assert.equal(nodes.length, 1);
  await store.close();
});

add_task(async function test_an_archived_trail_does_not_come_back() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });
  await store.addNode({ trailId, url: "https://example.invalid/" });
  // Through the verb's own writer rather than raw SQL. The filter below was
  // tested for a long time against a state nothing in the product could reach.
  await store.archiveTrail(trailId, 5);

  const { trails } = await store.restorable();
  Assert.equal(trails.length, 0, "archiving is how a trail stops being open");
  await store.close();
});

add_task(async function test_archiving_leaves_the_trail_and_its_recency() {
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "reading", now: 1000 });
  await store.addNode({ trailId, url: "https://example.invalid/" });

  await store.archiveTrail(trailId, 7000);

  const [row] = await store.connection.execute(
    "SELECT name, updated_at, archived_at FROM trail WHERE id = :id",
    { id: trailId }
  );
  Assert.equal(row.getResultByName("name"), "reading");
  Assert.equal(row.getResultByName("archived_at"), 7000);
  Assert.equal(
    row.getResultByName("updated_at"),
    1000,
    "finishing a trail is a statement about the work, not more of it — moving " +
      "updated_at would make every archived trail look freshly worked on"
  );
  Assert.equal(
    (
      await store.connection.execute(
        "SELECT COUNT(*) AS n FROM trail_node WHERE trail_id = :id",
        { id: trailId }
      )
    )[0].getResultByName("n"),
    1,
    "and the pages are still there to be found by subject"
  );
  await store.close();
});

add_task(async function test_archiving_twice_keeps_the_first_time() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });

  await store.archiveTrail(trailId, 7000);
  await store.archiveTrail(trailId, 9000);

  const [row] = await store.connection.execute(
    "SELECT archived_at FROM trail WHERE id = :id",
    { id: trailId }
  );
  Assert.equal(row.getResultByName("archived_at"), 7000);
  await store.close();
});

add_task(async function test_restored_nodes_carry_what_re_entry_needs() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });
  const root = await store.addNode({
    trailId,
    url: "https://example.invalid/",
    title: "Root",
  });
  const child = await store.addNode({
    trailId,
    parentId: root,
    url: "https://example.invalid/child",
  });
  await store.updateNode(child, {
    scrollY: 820,
    formState: '{"entry":{"url":"https://example.invalid/child"}}',
  });
  const gone = await store.addNode({
    trailId,
    url: "https://example.invalid/x",
  });
  await store.dismissNode(gone, 4242);

  const [, restoredChild, restoredGone] = await store.nodesForTrails([trailId]);
  Assert.equal(restoredChild.parent_id, root, "the shape of the tree");
  Assert.equal(restoredChild.scroll_y, 820, "where the user was on the page");
  Assert.ok(restoredChild.form_state.includes("entry"), "and what they typed");
  Assert.equal(
    restoredGone.dismissed_at,
    4242,
    "a dismissed node is still on its trail, so leaving it out would make " +
      "dismissal into deletion at the next restart"
  );
  Assert.deepEqual(await store.nodesForTrails([]), []);
  await store.close();
});

add_task(async function test_a_restored_trail_finds_its_context_again() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });
  const mine = await store.addContext({ label: "mine", now: 1000 });
  const other = await store.addContext({ label: "other", now: 1000 });
  for (let i = 0; i < 3; i++) {
    const nodeId = await store.addNode({
      trailId,
      url: `https://example.invalid/${i}`,
    });
    // The last node was moved into another context by hand, which is exactly
    // what `context <mark>` does and must not change the trail's own topic.
    await store.addMember(i === 2 ? other : mine, {
      nodeId,
      source: i === 2 ? "manual" : "provenance",
    });
  }

  const contexts = await store.contextsForTrails([trailId]);
  Assert.equal(contexts.get(trailId), mine, "the provenance majority wins");
  Assert.equal((await store.contextsForTrails([])).size, 0);
  await store.close();
});

add_task(async function test_trail_pages_are_most_recently_visited_first() {
  // Tier 3 of the command bar's ranking. Read from the database rather than
  // from the window's tree, because a restored trail and a live one have to be
  // ranked by one rule.
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "memex" });
  const other = await store.addTrail({ name: "elsewhere" });

  const first = await store.addNode({
    trailId,
    url: "https://example.org/one",
    title: "One",
    now: 1000,
  });
  const second = await store.addNode({
    trailId,
    url: "https://example.org/two",
    title: "Two",
    now: 2000,
  });
  await store.addNode({
    trailId: other,
    url: "https://example.org/three",
    title: "Three",
    now: 3000,
  });
  // Visiting the older page again makes it the most recent thing on the trail.
  await store.updateNode(first, { lastVisitedAt: 4000 });

  const pages = await store.trailPages(trailId);
  Assert.deepEqual(
    pages.map(p => p.url),
    ["https://example.org/one", "https://example.org/two"],
    "only this trail's pages, most recently visited first"
  );
  Assert.equal(pages[0].id, first, "carrying the row id re-entry needs");
  Assert.equal(pages[1].id, second, "and so does the older one");

  Assert.equal(
    (await store.trailPages(trailId, { limit: 1 })).length,
    1,
    "the limit is honoured"
  );
  await store.close();
});

add_task(async function test_a_crossing_offers_what_the_other_trail_found() {
  // Tier 4, and the one tier no other browser could offer: another line of
  // enquiry reached a page this context reached, so the *rest* of what that
  // line found is material this context has never seen but demonstrably
  // neighbours. The connection was made by browsing, not by a threshold.
  const store = await freshStore();
  const mine = await store.addTrail({ name: "memex" });
  const theirs = await store.addTrail({ name: "hypertext" });

  const contextId = await store.addContext({ label: "memex" });
  const shared = await store.addNode({
    trailId: mine,
    url: "https://example.org/bush",
    title: "As We May Think",
  });
  await store.addMember(contextId, { nodeId: shared, source: "provenance" });

  // The other trail reached the same page...
  await store.addNode({
    trailId: theirs,
    url: "https://example.org/bush",
    title: "As We May Think",
    now: 1000,
  });
  // ...and went on to something this context has never seen.
  await store.addNode({
    trailId: theirs,
    url: "https://example.org/xanadu",
    title: "Project Xanadu",
    now: 2000,
  });

  // A third trail that touched nothing in common must not appear.
  const unrelated = await store.addTrail({ name: "unrelated" });
  await store.addNode({
    trailId: unrelated,
    url: "https://example.org/weather",
    title: "Weather",
  });

  const rows = await store.contextCrossings(contextId, {
    excludeTrailId: mine,
  });
  Assert.deepEqual(
    rows.map(r => r.url),
    ["https://example.org/xanadu", "https://example.org/bush"],
    "what the crossing trail found, most recent first, and nothing unrelated"
  );
  Assert.equal(
    rows[0].trail_name,
    "hypertext",
    "named, so the row can say why"
  );

  // A page on the user's own trail that the context has not claimed. With the
  // active trail excluded it belongs to tier 3 and must not appear here;
  // without an exclusion this read has no opinion about whose trail is whose.
  await store.addNode({
    trailId: mine,
    url: "https://example.org/aside",
    now: 5000,
  });
  const excluded = await store.contextCrossings(contextId, {
    excludeTrailId: mine,
  });
  Assert.ok(
    !excluded.some(r => r.trail_id === mine),
    "the excluded trail contributes nothing, whatever it holds"
  );
  const withMine = await store.contextCrossings(contextId);
  Assert.ok(
    withMine.some(r => r.url === "https://example.org/aside"),
    "and without the exclusion it is a crossing like any other"
  );
  await store.close();
});

add_task(async function test_a_crossing_never_repeats_the_context() {
  // Tier 2 already holds the context's own pages, so tier 4 must not offer
  // them again — the tiers are only explainable if a page appears once.
  const store = await freshStore();
  const mine = await store.addTrail({ name: "memex" });
  const theirs = await store.addTrail({ name: "hypertext" });
  const contextId = await store.addContext({ label: "memex" });

  const shared = await store.addNode({
    trailId: mine,
    url: "https://example.org/bush",
  });
  const alsoMine = await store.addNode({
    trailId: theirs,
    url: "https://example.org/nelson",
  });
  await store.addMember(contextId, { nodeId: shared, source: "provenance" });
  await store.addMember(contextId, { nodeId: alsoMine, source: "provenance" });
  await store.addNode({ trailId: theirs, url: "https://example.org/bush" });

  const rows = await store.contextCrossings(contextId, {
    excludeTrailId: mine,
  });
  Assert.ok(
    !rows.some(r => r.id === alsoMine),
    "a page the context already claims is not offered as a crossing"
  );
  await store.close();
});

add_task(async function test_a_context_with_no_crossings_offers_none() {
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "alone" });
  const contextId = await store.addContext({ label: "alone" });
  const node = await store.addNode({
    trailId,
    url: "https://example.org/only",
  });
  await store.addMember(contextId, { nodeId: node, source: "provenance" });

  Assert.deepEqual(
    await store.contextCrossings(contextId, { excludeTrailId: trailId }),
    [],
    "no other trail has been anywhere this one has"
  );
  await store.close();
});

add_task(async function test_an_insert_returns_its_own_id_under_concurrency() {
  // One store is shared by every window in the process, and each window's
  // engine serialises only its own writes, so two windows' inserts interleave
  // on one connection as a matter of course. `last_insert_rowid()` is a
  // property of that connection across every table on it, so reading it in a
  // statement after the INSERT returned whatever had most recently been
  // written by anyone — a plausible integer from the wrong table.
  //
  // Nothing here deletes rows, so the damage was permanent and silent: nodes
  // filed under a `trail_id` no trail had, membership naming nodes that were
  // never written, and reads that join through those references quietly
  // returning less than the database holds.
  //
  // Two tables and interleaved writers is the smallest shape that shows it.
  const store = await freshStore();
  const trailId = await store.addTrail({ name: "concurrent" });
  const nodeId = await store.addNode({
    trailId,
    url: "https://example.org/root",
  });

  // Not awaited one at a time — that is the whole point. Serialised, the old
  // pair of statements was correct, which is why this only ever showed up with
  // a second window open.
  const pending = [];
  for (let i = 0; i < 20; i++) {
    pending.push(store.addTrail({ name: `t${i}` }).then(id => ["trail", id]));
    pending.push(store.startVisit(nodeId).then(id => ["visit", id]));
  }
  const written = await Promise.all(pending);

  const byTable = { trail: [], visit: [] };
  for (const [table, id] of written) {
    byTable[table].push(id);
  }

  for (const [table, ids] of Object.entries(byTable)) {
    Assert.equal(
      new Set(ids).size,
      ids.length,
      `every ${table} insert reported a distinct id`
    );
    for (const id of ids) {
      const [row] = await store.connection.execute(
        `SELECT COUNT(*) AS n FROM ${table} WHERE id = :id`,
        { id }
      );
      Assert.equal(
        row.getResultByName("n"),
        1,
        `the id reported for a ${table} insert names a row of ${table}`
      );
    }
  }
  await store.close();
});

// ---- merged contexts ------------------------------------------------------

/**
 * Two trails, each with its own context by provenance, and a query in each.
 *
 * @param {object} store
 * @returns {Promise<object>} `{trails: [id, id], contexts: [id, id]}`.
 */
async function twoEnquiries(store) {
  const trails = [];
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const trailId = await store.addTrail({ now: 1000 + i });
    const contextId = await store.addContext({
      label: `enquiry ${i}`,
      now: 1000 + i,
    });
    const nodeId = await store.addNode({
      trailId,
      url: `https://example.invalid/${i}`,
      title: `Page ${i}`,
    });
    await store.addMember(contextId, { nodeId, source: "provenance" });
    const queryId = await store.recordQuery({
      raw: `question ${i}`,
      normalisedIntent: `question ${i}`,
      sourceNodeId: nodeId,
      now: 1000 + i,
    });
    await store.addMember(contextId, { queryId, source: "provenance" });
    trails.push(trailId);
    contexts.push(contextId);
  }
  return { trails, contexts };
}

add_task(async function test_a_merge_moves_which_context_a_trail_is_in() {
  // The whole reason the merge is a column on `context` rather than a
  // membership row: `contextsForTrails` filters on provenance, so a merge
  // recorded as membership would leave both trails in their own contexts and
  // change nothing a user could see.
  const store = await freshStore();
  const { trails, contexts } = await twoEnquiries(store);

  let map = await store.contextsForTrails(trails);
  Assert.equal(map.get(trails[0]), contexts[0], "separate before the merge");
  Assert.equal(map.get(trails[1]), contexts[1]);

  await store.mergeContexts(contexts[1], contexts[0]);

  map = await store.contextsForTrails(trails);
  Assert.equal(map.get(trails[0]), contexts[0], "both resolve to the root");
  Assert.equal(map.get(trails[1]), contexts[0]);
  await store.close();
});

add_task(async function test_the_earlier_enquiry_survives_a_merge() {
  // An offer is symmetric, so accepting it from either side has to produce the
  // same database. Merging the low id into the high one still keeps the low.
  const store = await freshStore();
  const { contexts } = await twoEnquiries(store);

  const merged = await store.mergeContexts(contexts[0], contexts[1]);
  Assert.equal(merged.root, contexts[0], "the enquiry that started first wins");
  Assert.equal(merged.merged, contexts[1]);
  await store.close();
});

add_task(async function test_a_merge_leaves_every_provenance_row_alone() {
  const store = await freshStore();
  const { contexts } = await twoEnquiries(store);
  const before = await store.connection.execute(
    `SELECT context_id, source FROM context_member ORDER BY context_id`
  );

  await store.mergeContexts(contexts[1], contexts[0]);

  const after = await store.connection.execute(
    `SELECT context_id, source FROM context_member ORDER BY context_id`
  );
  Assert.equal(after.length, before.length, "no membership row was written");
  Assert.deepEqual(
    after.map(row => row.getResultByName("context_id")),
    before.map(row => row.getResultByName("context_id")),
    "and none was re-pointed — why a page is where it is still answers"
  );
  await store.close();
});

add_task(async function test_a_merged_context_reads_as_one_whole() {
  const store = await freshStore();
  const { contexts } = await twoEnquiries(store);
  await store.mergeContexts(contexts[1], contexts[0]);

  // Asked about either half, `what` and `pack` both answer about the whole.
  for (const asked of contexts) {
    const contents = await store.contextContents(asked);
    Assert.equal(contents.context.id, contexts[0], "answers as the root");
    Assert.equal(contents.queries.length, 2, "both enquiries' questions");
    Assert.equal(contents.pages.length, 2, "both enquiries' pages");
  }
  await store.close();
});

add_task(async function test_a_merged_context_is_no_longer_switchable() {
  const store = await freshStore();
  const { contexts } = await twoEnquiries(store);
  await store.mergeContexts(contexts[1], contexts[0]);

  const listed = await store.contexts();
  Assert.deepEqual(
    listed.map(row => row.id),
    [contexts[0]],
    "offering both halves back would be the browser arguing with the user"
  );
  Assert.equal(listed[0].members, 4, "and it counts what it absorbed");
  await store.close();
});

add_task(async function test_merging_into_a_merged_context_follows_the_chain() {
  // The invariant that keeps resolution one hop: `merged_into` must never name
  // a context that is itself merged.
  const store = await freshStore();
  const a = await store.addContext({ label: "a", now: 1000 });
  const b = await store.addContext({ label: "b", now: 1001 });
  const c = await store.addContext({ label: "c", now: 1002 });

  await store.mergeContexts(b, a);
  await store.mergeContexts(c, b);

  const roots = await store.mergeRoots();
  Assert.equal(roots.get(b), a);
  Assert.equal(roots.get(c), a, "not b, which is itself merged");
  Assert.deepEqual([...(await store.contextFamily(c))].sort(), [a, b, c]);
  await store.close();
});

add_task(async function test_merging_what_is_already_one_does_nothing() {
  const store = await freshStore();
  const a = await store.addContext({ label: "a", now: 1000 });
  const b = await store.addContext({ label: "b", now: 1001 });
  await store.mergeContexts(b, a);
  Assert.equal(await store.mergeContexts(a, b), null, "already one enquiry");
  Assert.equal(await store.mergeContexts(a, a), null, "and never with itself");
  await store.close();
});

add_task(async function test_a_declined_pair_is_remembered_both_ways_round() {
  const store = await freshStore();
  const a = await store.addContext({ label: "a", now: 1000 });
  const b = await store.addContext({ label: "b", now: 1001 });

  Assert.equal((await store.declinedMerges()).size, 0);
  // Declined from the far side, to prove the key is normalised rather than
  // recorded in whichever order the caller happened to pass.
  await store.declineMerge(b, a);

  const declined = await store.declinedMerges();
  Assert.ok(declined.has(`${a}:${b}`), "keyed low:high whichever way it came");
  await store.declineMerge(a, b);
  Assert.equal((await store.declinedMerges()).size, 1, "and only once");
  await store.close();
});

add_task(async function test_context_query_texts_are_raw_and_capped() {
  const store = await freshStore();
  const contextId = await store.addContext({ label: "a", now: 1000 });
  for (let i = 0; i < 5; i++) {
    const queryId = await store.recordQuery({
      raw: `Question ${i}`,
      normalisedIntent: `question ${i}`,
      now: 1000 + i,
    });
    await store.addMember(contextId, { queryId, source: "provenance" });
  }

  const all = await store.contextQueryTexts([contextId]);
  Assert.equal(all.get(contextId).length, 5);
  Assert.ok(
    all.get(contextId).includes("Question 4"),
    "raw, not normalised — the model's rows are words as written"
  );

  const capped = await store.contextQueryTexts([contextId], 2);
  Assert.equal(capped.get(contextId).length, 2, "most recent first, then cut");
  Assert.deepEqual(capped.get(contextId), ["Question 4", "Question 3"]);

  Assert.equal((await store.contextQueryTexts([])).size, 0);
  await store.close();
});

add_task(async function test_resuming_reopens_a_trail_and_lifts_it() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });
  await store.addNode({ trailId, url: "https://example.invalid/" });
  await store.archiveTrail(trailId, 7000);

  await store.resumeTrail(trailId, 9000);

  const { trails } = await store.restorable();
  Assert.deepEqual(
    trails.map(t => t.id),
    [trailId],
    "a resumed trail is offered again, which is what makes `done` reversible"
  );
  Assert.equal(
    trails[0].updated_at,
    9000,
    "and it is recent, because walking back into a trail is working on it"
  );
  await store.close();
});

add_task(async function test_resuming_an_open_trail_leaves_it_alone() {
  const store = await freshStore();
  const trailId = await store.addTrail({ now: 1000 });

  await store.resumeTrail(trailId, 9000);

  const [row] = await store.connection.execute(
    "SELECT updated_at FROM trail WHERE id = :id",
    { id: trailId }
  );
  Assert.equal(
    row.getResultByName("updated_at"),
    1000,
    "re-entry happens constantly; only the ones that undo a `done` may move it"
  );
  await store.close();
});
