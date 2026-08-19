/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Pillar C in a real chrome window.
 *
 * The derivations are covered in node and the SQL is covered in xpcshell;
 * neither can see what is here. What is here is that browsing actually writes
 * rows, that a query issued at the command bar actually reaches the page it
 * opened, that the verbs are bound and answer, and that the recording never
 * lands on the navigation path — which is the one property that would be
 * invisible right up to the moment it made the browser feel slow.
 */

const { FOSContextEngine, contextKey } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { FOSContextStore } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextStore.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";

function engine() {
  return FOSContextEngine.forWindow(window);
}

function bar() {
  return FOSCommandBar.forWindow(window);
}

/**
 * Navigate the selected tab and wait for the load to commit.
 *
 * @param {string} url Where to go.
 */
async function goTo(url) {
  const browser = gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, url);
  await BrowserTestUtils.browserLoaded(browser, false, url);
}

/**
 * Let the recorder's queue drain.
 *
 * Recording is deliberately off the navigation path, so a test that asserts
 * immediately after a load is asserting on a race. Awaiting the queue is the
 * supported way to observe it and is the reason `settled` is exposed at all.
 *
 * @returns {Promise<object>} The store.
 */
async function settled() {
  await engine().settled;
  return FOSContextEngine.store();
}

/**
 * The highest node id written so far.
 *
 * @returns {Promise<number>}
 */
async function highWaterMark() {
  const store = await settled();
  const [row] = await store.connection.execute(
    "SELECT COALESCE(MAX(id), 0) AS id FROM trail_node"
  );
  return row.getResultByName("id");
}

registerCleanupFunction(() => {
  bar().close();
  bar().dismissNotice();
});

add_task(async function test_browsing_writes_the_tree_down() {
  // Scoped to rows this task creates. The whole component suite browses these
  // same two URLs in one window, so an unscoped lookup finds an earlier task's
  // nodes and asserts a parent relationship that was never claimed here.
  const since = await highWaterMark();
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  const store = await settled();

  const rows = await store.connection.execute(
    `SELECT n.id, n.url, n.parent_id FROM trail_node n
     WHERE n.url IN (:a, :b) AND n.id > :since ORDER BY n.id`,
    { a: PAGE_A, b: PAGE_B, since }
  );
  const nodes = rows.map(row => ({
    id: row.getResultByName("id"),
    url: row.getResultByName("url"),
    parent: row.getResultByName("parent_id"),
  }));

  const first = nodes.find(node => node.url === PAGE_A);
  const second = nodes.find(node => node.url === PAGE_B);
  Assert.ok(first, "the first page was recorded");
  Assert.ok(second, "the second page was recorded");
  Assert.equal(
    second.parent,
    first.id,
    "and the second is the first's child, so the tree is the tree the user sees"
  );
});

add_task(async function test_a_page_joins_its_trail_context_by_provenance() {
  await goTo(PAGE_A);
  const store = await settled();

  const contextId = engine().activeContextId;
  Assert.notStrictEqual(contextId, null, "browsing started a context");

  const [row] = await store.connection.execute(
    `SELECT m.source FROM context_member m
     JOIN trail_node n ON n.id = m.trail_node_id
     WHERE m.context_id = :id AND n.url = :url`,
    { id: contextId, url: PAGE_A }
  );
  Assert.ok(row, "the page is in the context");
  Assert.equal(
    row.getResultByName("source"),
    "provenance",
    "attributed to provenance, which is what makes the decision explainable"
  );
});

add_task(async function test_a_query_is_recorded_and_reaches_its_page() {
  // The query and the page it opens are recorded by two different mechanisms —
  // one at the command bar, one at the progress listener — so that they meet is
  // a real property and not an implementation detail.
  //
  // The query is handed to the recorder directly rather than typed, because
  // typing a prose query sends the default search engine a live request and the
  // harness rightly refuses to leave the machine. What that costs is covered by
  // the next task, which asserts the command bar's hook fires at all; between
  // the two, every link in the chain is exercised without a network.
  const raw = "vannevar bush memex";
  engine().recordQuery(raw);
  await goTo(PAGE_B);
  const store = await settled();

  const [row] = await store.connection.execute(
    `SELECT q.normalised_intent, q.input_mode, q.trail_node_id
     FROM query q WHERE q.raw = :raw ORDER BY q.id DESC LIMIT 1`,
    { raw }
  );
  Assert.ok(row, "the query was recorded");
  Assert.equal(
    row.getResultByName("normalised_intent"),
    "vannevar bush memex",
    "with its normalised intent"
  );
  Assert.equal(row.getResultByName("input_mode"), "keyboard");
  Assert.ok(
    row.getResultByName("trail_node_id"),
    "and it was attached to the page it opened"
  );

  // `vannevar` and not `vannevar bush`: the query was typed in lower case, so
  // there is no capitalisation for the extractor to read a name off. That is
  // the honest limit of a shallow extractor and it bites hardest exactly here,
  // because queries are typed in lower case far more often than page titles
  // are. Page titles are where it earns its keep until a model does the job.
  const [entity] = await store.connection.execute(
    `SELECT e.name FROM entity e
     JOIN entity_mention m ON m.entity_id = e.id
     WHERE e.canonical = 'vannevar' AND m.query_id IS NOT NULL`
  );
  Assert.ok(entity, "and its entities were extracted");
});

add_task(async function test_the_command_bar_feeds_the_recorder() {
  // `openQuery` is the single funnel for both ways a query can arrive, so one
  // hook catches all of them. This asserts the hook, not the parsing: a
  // URL-shaped line keeps the load local.
  const loaded = BrowserTestUtils.browserLoaded(gBrowser.selectedBrowser);
  bar().run(PAGE_A);
  await loaded;
  const store = await settled();

  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS n FROM query WHERE raw = :raw`,
    { raw: PAGE_A }
  );
  Assert.greater(
    row.getResultByName("n"),
    0,
    "running a line at the command bar recorded it as a query"
  );
});

add_task(async function test_a_visit_accrues_dwell_and_an_outcome() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  const store = await settled();

  const [row] = await store.connection.execute(
    `SELECT v.dwell_ms, v.outcome FROM visit v
     JOIN trail_node n ON n.id = v.trail_node_id
     WHERE n.url = :url AND v.outcome IS NOT NULL
     ORDER BY v.id DESC LIMIT 1`,
    { url: PAGE_A }
  );
  Assert.ok(row, "leaving a page closed its visit");
  Assert.greaterOrEqual(
    row.getResultByName("dwell_ms"),
    0,
    "dwell was measured"
  );
  Assert.equal(
    row.getResultByName("outcome"),
    "bounced",
    "and a page left in under 30 seconds is honestly a bounce"
  );
});

add_task(async function test_the_verbs_are_bound() {
  // An unwired verb reports NOT_WIRED and stops the chain, so this is the
  // difference between pillar C existing and pillar C being announced.
  for (const verb of ["context", "pack", "what"]) {
    Assert.ok(bar().actions.has(verb), `${verb} has a handler`);
  }
  Assert.deepEqual(
    bar().actions.unwired(),
    [],
    "every verb in the action table now runs"
  );
});

add_task(async function test_what_answers_in_a_sentence() {
  await goTo(PAGE_A);
  await settled();

  const message = await engine().report(() => engine().summarise());
  Assert.ok(message, "there is an answer");
  Assert.ok(
    /page/.test(message),
    `the answer says what is in the context: ${message}`
  );

  const report = document.querySelector(".fos-report");
  Assert.ok(report, "the answer has somewhere to be said");
  Assert.ok(!report.hidden, "and it is showing");
  Assert.equal(report.textContent, message);
  Assert.equal(
    report.getAttribute("aria-live"),
    "polite",
    "a screen reader is told too, since this is the only place it is said"
  );
  bar().dismissNotice();
  Assert.ok(report.hidden, "and it can be dismissed");
});

add_task(async function test_pack_exports_a_brief_to_the_clipboard() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  await settled();

  await SimpleTest.promiseClipboardChange(
    text => text.includes("# Context pack"),
    () => bar().actions.run({ action: "pack", target: null, text: null })
  );

  const pack = await navigator.clipboard.readText();
  Assert.ok(pack.includes("## Questions asked"), "the brief has its sections");
  Assert.ok(pack.includes("## Pages"), "and its pages");
  Assert.ok(
    pack.includes(PAGE_A) || pack.includes(PAGE_B),
    "and a page that was actually browsed in this test"
  );
  Assert.ok(
    pack.includes("Frontier OpenSearch"),
    "and says where it came from, since a model should not have to guess"
  );
});

add_task(async function test_a_context_earns_a_mark_by_being_named() {
  await goTo(PAGE_A);
  await settled();

  const session = FOSTrailSession.forWindow(window);
  const contextId = engine().activeContextId;
  const marks = session.marks;

  // The 26 letters are one budget shared by every pillar and by every task in
  // this file, so this starts from a known state. Without it the assertion
  // below is really about how many marks the preceding tests happened to leave,
  // and it passed alone while failing in the suite. What that exposes is real
  // and is recorded in STATE: under genuine mark pressure — a Field holding
  // forty cards — a named context can fail to get a letter and `context <mark>`
  // cannot reach it. That is a budget question to settle deliberately, not
  // something to paper over here.
  marks.clear();

  Assert.equal(
    marks.markOf(contextKey(contextId)),
    null,
    "an unnamed context spends none of the 26, because there is nothing to " +
      "switch to — it is the trail you are already on"
  );

  // Naming the trail is what promotes its context to something you might come
  // back to, and that is when it earns a letter.
  // Not "name a research context": `name` takes an optional mark, and a
  // leading single letter parses as one.
  bar().run("name memex research");
  await settled();

  Assert.equal(
    session.store.getTrail(session.activeTrailId)?.name,
    "memex research",
    "the trail took the name"
  );

  const letter = marks.markOf(contextKey(contextId));
  Assert.ok(letter, "a named context is addressable");
  Assert.equal(
    marks.typeAt(letter),
    "context",
    "and it is addressable as a context, so `context <mark>` can reach it"
  );

  const outcome = bar().actions.run({
    action: "context",
    target: letter,
    text: null,
  });
  Assert.ok(outcome.ok, "the verb ran");
  Assert.equal(outcome.result, contextId, "and switched to that context");
});

add_task(async function test_a_restart_brings_the_previous_session_back() {
  // A restart, told honestly: a database with yesterday's tree in it, a window
  // whose tree is empty, and nothing shared between the two but the file. This
  // is the property the fork claimed and did not have — the tree was
  // session-scoped, so closing the browser lost every branch it had promised
  // never to destroy.
  const path = PathUtils.join(PathUtils.profileDir, "restore-test.sqlite");
  await IOUtils.remove(path, { ignoreAbsent: true });
  const store = await FOSContextStore.open({ path });
  const trailId = await store.addTrail({ name: "yesterday", now: 1000 });
  const root = await store.addNode({ trailId, url: PAGE_A, title: "A" });
  const child = await store.addNode({
    trailId,
    parentId: root,
    url: PAGE_B,
    title: "B",
  });
  await store.updateNode(child, { scrollY: 512 });
  const contextId = await store.addContext({ label: "yesterday", now: 1000 });
  for (const nodeId of [root, child]) {
    await store.addMember(contextId, { nodeId, source: "provenance" });
  }

  const session = new FOSTrailSession(window);
  const revived = new FOSContextEngine(window);
  registerCleanupFunction(async () => {
    revived.detach();
    session.detach();
    await store.close();
  });

  await revived.attach({ session, store });
  await revived.settled;

  Assert.deepEqual(
    session.store.nodes().map(node => node.id),
    [root, child],
    "yesterday's nodes came back, under the ids the database gave them"
  );
  Assert.equal(
    session.store.getNode(child).parent_id,
    root,
    "and the shape of the tree came back with them"
  );
  Assert.equal(
    session.store.getNode(child).scroll_y,
    512,
    "including where on the page the user had got to"
  );
  Assert.equal(
    session.activeTrailId,
    trailId,
    "a restored trail is active, so the rail has something to draw and its " +
      "nodes can take marks"
  );
  Assert.equal(
    revived.activeContextId,
    contextId,
    "and the topic came back with the trail rather than starting again"
  );

  const [countRow] = await store.connection.execute(
    "SELECT COUNT(*) AS n FROM trail_node"
  );
  Assert.equal(
    countRow.getResultByName("n"),
    2,
    "reconciliation after a restore writes nothing: the id maps were seeded " +
      "by the restore, so the rows it just read are rows it knows about. " +
      "Without that, every restart would double the tree"
  );

  // What the user actually asked for: yesterday's page, open again.
  session.attach();
  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    PAGE_B
  );
  Assert.ok(await session.enter(child), "a restored node can be re-entered");
  await loaded;
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_B,
    "and the page it names is the page that loads"
  );

  // And today's browsing continues the trail rather than starting beside it.
  await goTo(PAGE_A);
  await revived.settled;
  const [added] = await store.connection.execute(
    `SELECT parent_id FROM trail_node WHERE id > :child ORDER BY id`,
    { child }
  );
  Assert.ok(added, "the next page was recorded");
  Assert.equal(
    added.getResultByName("parent_id"),
    child,
    "as a child of the restored node, so a restart is not a fresh start"
  );

  session.detach();
  revived.detach();
});

add_task(async function test_a_restart_brings_back_where_the_user_put_things() {
  // The other half of a restart. The tree came back a dozen runs ago; the
  // arrangement did not, because `field_placement` had a table, a store method
  // and no caller — see IDEAS.md run 42. Pillar A is stubbed here on purpose:
  // what is under test is the translation pillar C does, from rows keyed by
  // database id to the nodes a window actually has.
  const path = PathUtils.join(PathUtils.profileDir, "restore-placement.sqlite");
  await IOUtils.remove(path, { ignoreAbsent: true });
  const store = await FOSContextStore.open({ path });
  const trailId = await store.addTrail({ name: "yesterday", now: 1000 });
  const root = await store.addNode({ trailId, url: PAGE_A, title: "A" });
  const child = await store.addNode({
    trailId,
    parentId: root,
    url: PAGE_B,
    title: "B",
  });
  // One card the user moved, one the system seeded. Only the first is a fact
  // about what the user thinks; the second re-seeds to the same seat anyway.
  await store.placeCard(child, { x: 64, y: 32, pinned: true, movedByUserAt: 5 });
  await store.placeCard(root, { x: 1, y: 1 });

  let handed = null;
  const field = {
    onPlacement: () => () => {},
    restorePlacements: byNode => {
      handed = byNode;
    },
  };

  const session = new FOSTrailSession(window);
  const revived = new FOSContextEngine(window);
  registerCleanupFunction(async () => {
    revived.detach();
    session.detach();
    await store.close();
  });

  await revived.attach({ session, store, field });
  await revived.settled;

  Assert.ok(handed, "the Field was told about the previous arrangement");
  Assert.equal(handed.size, 1, "and only about the position a human chose");
  Assert.deepEqual(
    handed.get(child),
    { x: 64, y: 32 },
    "keyed by the node this window has, not by the row it came from"
  );
});

add_task(async function test_a_placement_is_written_to_the_row_it_belongs_to() {
  // The write half. The Field speaks in the node ids its window has and the
  // store in row ids, and the engine is the only place the two are joined.
  // The id map is seeded here by a restore rather than by browsing, because
  // what is under test is the translation and not the reconciliation.
  const path = PathUtils.join(PathUtils.profileDir, "record-placement.sqlite");
  await IOUtils.remove(path, { ignoreAbsent: true });
  const store = await FOSContextStore.open({ path });
  const trailId = await store.addTrail({ name: "yesterday", now: 1000 });
  const rowId = await store.addNode({ trailId, url: PAGE_A, title: "A" });

  let announce = null;
  const field = {
    onPlacement: listener => {
      announce = listener;
      return () => {};
    },
    restorePlacements: () => {},
  };

  const session = new FOSTrailSession(window);
  const engine = new FOSContextEngine(window);
  registerCleanupFunction(async () => {
    engine.detach();
    session.detach();
    await store.close();
  });

  await engine.attach({ session, store, field });
  await engine.settled;
  Assert.ok(announce, "the engine is listening to the Field");

  const [node] = session.store.nodes();
  Assert.ok(node, "the restore gave this window a node to place");

  await announce({ nodeId: node.id, x: 12, y: 34 });

  const saved = await store.placements([rowId]);
  Assert.deepEqual(
    saved.get(rowId),
    { x: 12, y: 34 },
    "the position landed on the row the node was written as"
  );

  // A node the reconciliation has not reached yet is dropped rather than
  // queued: the position is on the card, so the next drop carries it, and a
  // queued coordinate would be one a later drag had already made wrong.
  await announce({ nodeId: 987654, x: 1, y: 2 });
  Assert.equal(
    (await store.placements([rowId])).get(rowId).x,
    12,
    "and an unknown node changed nothing"
  );
});

add_task(async function test_only_one_window_restores_a_database() {
  const path = PathUtils.join(PathUtils.profileDir, "restore-claim.sqlite");
  await IOUtils.remove(path, { ignoreAbsent: true });
  const store = await FOSContextStore.open({ path });
  const trailId = await store.addTrail({ now: 1000 });
  await store.addNode({ trailId, url: PAGE_A });

  const first = new FOSTrailSession(window);
  const second = new FOSTrailSession(window);
  const engines = [new FOSContextEngine(window), new FOSContextEngine(window)];
  await engines[0].attach({ session: first, store });
  await engines[1].attach({ session: second, store });
  await Promise.all(engines.map(each => each.settled));

  Assert.equal(first.store.nodes().length, 1, "the first window gets the past");
  Assert.equal(
    second.store.nodes().length,
    0,
    "and the second opens as it always did, rather than putting the same " +
      "trail on a second Field with two windows reconciling onto one row"
  );

  for (const each of engines) {
    each.detach();
  }
  await store.close();
});
