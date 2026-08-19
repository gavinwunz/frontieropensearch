/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Clearing history actually reaches the Context Engine.
 *
 * The store's own tests cover what forgetting does to the graph. What they
 * cannot see is the part that was actually broken: that `nsIClearDataService`
 * — the service behind Clear Recent History and Forget About This Site —
 * knows this fork's database exists at all. Before the cleaner was registered
 * every assertion in the xpcshell file passed and the shipped menu item still
 * cleared only half of what it claimed to.
 *
 * Nothing here calls `deleteData` or `forgetAll`. Every file in this directory
 * shares one window over one profile database, so a test that wiped the store
 * would take the trails, marks and contexts that later files are still using
 * with it. The host used below exists nowhere else in the suite, and the range
 * cleared is a window in 1970 that only this file writes into, so both run the
 * real service end to end while touching nothing that is not ours.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FORGOTTEN_TOPIC } = ChromeUtils.importESModule(
  "resource:///modules/FOSForget.sys.mjs"
);

/** A host no other file in this directory records anything against. */
const DOOMED_HOST = "forget-me.invalid";

/**
 * Count `trail_node` rows matching a URL pattern.
 *
 * @param {object} store
 * @param {string} pattern A SQL `LIKE` pattern.
 * @returns {Promise<number>}
 */
async function nodesLike(store, pattern) {
  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS n FROM trail_node WHERE url LIKE :pattern`,
    { pattern }
  );
  return row.getResultByName("n");
}

/**
 * Run a clear and resolve when it reports back.
 *
 * @param {Function} invoke Takes the callback to hand the service.
 * @returns {Promise<number>} The failed-flags value the service reports.
 */
function clearing(invoke) {
  return new Promise(resolve => {
    invoke({
      onDataDeleted: failedFlags => resolve(failedFlags),
    });
  });
}

add_task(async function test_forget_about_this_site_reaches_the_store() {
  const store = await FOSContextEngine.store();
  const trailId = await store.addTrail({ name: "a trail to be forgotten" });
  const doomed = await store.addNode({
    trailId,
    url: `https://${DOOMED_HOST}/page`,
  });
  await store.addNode({
    trailId,
    parentId: doomed,
    url: `https://docs.${DOOMED_HOST}/deeper`,
  });
  const question = await store.recordQuery({
    raw: "something typed on a page about to be forgotten",
    trailNodeId: doomed,
  });

  Assert.equal(
    await nodesLike(store, `%${DOOMED_HOST}%`),
    2,
    "the fixture is in the database before anything is cleared"
  );

  const forgotten = TestUtils.topicObserved(FORGOTTEN_TOPIC);
  const failedFlags = await clearing(callback =>
    Services.clearData.deleteDataFromHost(
      DOOMED_HOST,
      true,
      Ci.nsIClearDataService.CLEAR_HISTORY,
      callback
    )
  );
  await forgotten;

  Assert.equal(failedFlags, 0, "the service reports the clear succeeded");
  Assert.equal(
    await nodesLike(store, `%${DOOMED_HOST}%`),
    0,
    "Forget About This Site reaches the Context Engine, host and subdomain"
  );

  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS n FROM query WHERE id = :question`,
    { question }
  );
  Assert.equal(
    row.getResultByName("n"),
    0,
    "and takes the search that was typed on the forgotten page with it"
  );
});

add_task(async function test_clearing_a_time_range_reaches_the_store() {
  const store = await FOSContextEngine.store();
  const trailId = await store.addTrail({ name: "a trail in 1970" });
  // Inside the window cleared below, and far enough back that nothing else in
  // the suite can have written here.
  const inside = await store.addNode({
    trailId,
    url: `https://${DOOMED_HOST}/in-range`,
    now: 5_000_000,
  });
  const outside = await store.addNode({
    trailId,
    url: `https://${DOOMED_HOST}/out-of-range`,
    now: 90_000_000,
  });

  const forgotten = TestUtils.topicObserved(FORGOTTEN_TOPIC);
  const failedFlags = await clearing(callback =>
    // The service deals in microseconds.
    Services.clearData.deleteDataInTimeRange(
      1_000_000 * 1000,
      10_000_000 * 1000,
      true,
      Ci.nsIClearDataService.CLEAR_HISTORY,
      callback
    )
  );
  await forgotten;

  Assert.equal(failedFlags, 0, "the service reports the clear succeeded");

  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS n FROM trail_node WHERE id IN (:inside, :outside)`,
    { inside, outside }
  );
  Assert.equal(
    row.getResultByName("n"),
    1,
    "clearing a range takes what was recorded inside it and leaves the rest"
  );

  // Leave the directory's shared database as this file found it.
  await store.forgetHost(DOOMED_HOST);
});

/**
 * A host this file is the only user of, so that clearing it in a shared window
 * takes nothing another file is still relying on. Unlike `DOOMED_HOST` above
 * it is one the test server actually serves, because these tests need pages
 * that are really loaded in real tabs.
 */
const LIVE_HOST = "test2.example.com";
const LIVE_PAGE = `https://${LIVE_HOST}/`;
const LIVE_SUBDOMAIN = `https://sub1.${LIVE_HOST}/`;
/** A page on a host nothing here forgets, to be the survivor. */
const KEPT_PAGE = "https://example.org/";

/**
 * Navigate a browser and wait for the load to commit.
 *
 * @param {object} browser The browser element.
 * @param {string} url Where to go.
 */
async function goTo(browser, url) {
  BrowserTestUtils.startLoadingURIString(browser, url);
  await BrowserTestUtils.browserLoaded(browser, false, url);
}

/**
 * Clear a host through the real service and wait for the engine to react.
 *
 * @param {string} host The host to forget.
 * @returns {Promise<void>}
 */
async function forgetHost(host) {
  const forgotten = TestUtils.topicObserved(FORGOTTEN_TOPIC);
  await clearing(callback =>
    Services.clearData.deleteDataFromHost(
      host,
      true,
      Ci.nsIClearDataService.CLEAR_HISTORY,
      callback
    )
  );
  await forgotten;
}

add_task(async function test_forgetting_reaches_the_live_window() {
  const { FOSTrailSession } = ChromeUtils.importESModule(
    "resource:///modules/FOSTrailSession.sys.mjs"
  );
  const { FOSFieldSurface } = ChromeUtils.importESModule(
    "resource:///modules/FOSFieldSurface.sys.mjs"
  );
  const session = FOSTrailSession.forWindow(window);
  const field = FOSFieldSurface.forWindow(window);
  const engine = FOSContextEngine.forWindow(window);

  // One tab that walks off the doomed host onto a page that survives, so the
  // reparenting rule is exercised where it can be seen; and a second tab left
  // sitting on the doomed host, which is the case with the actual question in
  // it — what happens to the page you are looking at.
  const walker = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await goTo(walker.linkedBrowser, LIVE_PAGE);
  await goTo(walker.linkedBrowser, LIVE_SUBDOMAIN);
  await goTo(walker.linkedBrowser, KEPT_PAGE);
  const walkerTrail = session.activeTrailId;

  const sitter = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await goTo(sitter.linkedBrowser, LIVE_PAGE);
  const sitterTrail = session.activeTrailId;
  const sitterNode = session.currentNodeId;
  await engine.settled;

  const doomedNodes = session.store
    .nodes()
    .filter(node => node.url.includes(LIVE_HOST))
    .map(node => node.id);
  const kept = session.store
    .nodes(walkerTrail)
    .find(node => node.url === KEPT_PAGE);
  Assert.equal(doomedNodes.length, 3, "the fixture is in the live tree");
  Assert.ok(field.model.cardForNode(sitterNode), "and on the Field");
  Assert.equal(
    session.nodeForBrowser(sitter.linkedBrowser),
    sitterNode,
    "and the tab in front is recording against it"
  );

  await forgetHost(LIVE_HOST);

  for (const nodeId of doomedNodes) {
    Assert.equal(
      session.store.getNode(nodeId),
      null,
      "the forgotten page left the live tree, not only the database"
    );
    Assert.equal(
      field.model.cardForNode(nodeId),
      null,
      "and its card left the Field"
    );
  }
  Assert.equal(
    session.store.getNode(kept.id)?.parent_id,
    null,
    "a page found *from* a forgotten one stays, climbing to the nearest " +
      "survivor — here there is none, so it becomes a root"
  );
  Assert.ok(
    field.model.cardForNode(kept.id),
    "and keeps its card, because the page it was found from going is not a " +
      "reason to forget the page that answered the question"
  );
  Assert.equal(
    session.store.getTrail(sitterTrail),
    null,
    "a trail with nothing left on it goes with its last page"
  );

  // The decision this run had to make, stated as an assertion.
  Assert.ok(
    !sitter.closing && gBrowser.tabs.includes(sitter),
    "the tab is not closed: a menu item that promised to delete data must " +
      "not take the document you are reading with it"
  );
  Assert.equal(
    sitter.linkedBrowser.currentURI.spec,
    LIVE_PAGE,
    "and the page is still loaded and still readable"
  );
  Assert.equal(
    session.nodeForBrowser(sitter.linkedBrowser),
    null,
    "what it loses is the record: the tab is left unrecorded, so nothing " +
      "further is written against a row that no longer exists"
  );
  Assert.equal(session.currentNodeId, null, "including the dwell clock");

  // `back` walks the window's own recency list, which is not the tree and was
  // not pruned by anything above. A forgotten id left in it is a page `enter`
  // throws on, and the throw would land on the next `back` rather than here —
  // which is why this is asserted rather than reasoned about.
  gBrowser.selectedTab = walker;
  const { FOSCommandBar } = ChromeUtils.importESModule(
    "resource:///modules/FOSCommandBar.sys.mjs"
  );
  const back = FOSCommandBar.forWindow(window).run("back");
  // `run` hands back the handler's return value rather than awaiting it, and
  // `enter` restores asynchronously — a test that closed these tabs without
  // waiting would have `setTabState` land on a browser that had gone.
  await Promise.all(back.ran.map(outcome => outcome.result));
  Assert.ok(
    !doomedNodes.includes(session.currentNodeId),
    "going back does not land on a page that has been forgotten"
  );

  BrowserTestUtils.removeTab(sitter);
  BrowserTestUtils.removeTab(walker);
});

add_task(async function test_the_engine_does_not_write_the_pages_back() {
  const { FOSTrailSession } = ChromeUtils.importESModule(
    "resource:///modules/FOSTrailSession.sys.mjs"
  );
  const session = FOSTrailSession.forWindow(window);
  const engine = FOSContextEngine.forWindow(window);
  const store = await FOSContextEngine.store();

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  await goTo(tab.linkedBrowser, LIVE_PAGE);
  await engine.settled;
  Assert.greater(
    await nodesLike(store, `%${LIVE_HOST}%`),
    0,
    "the page was recorded before it was forgotten"
  );

  await forgetHost(LIVE_HOST);
  // Forgetting changes the tree, which is a reconciliation, which is the exact
  // moment the resurrection would happen: a node the engine cannot find in its
  // id map is a node it decides has never been written and adds. Pruning the
  // tree and the map together is what makes that safe, and this is the
  // assertion that it was done in that order.
  await engine.settled;

  Assert.equal(
    await nodesLike(store, `%${LIVE_HOST}%`),
    0,
    "and the reconciliation that followed the delete did not put it back"
  );

  // Forgetting is a delete, not a blocklist — Forget About This Site is not
  // one either. A tab left open on a forgotten host records again the moment
  // it is navigated, which is the user browsing there again.
  await goTo(tab.linkedBrowser, `${LIVE_PAGE}?after`);
  await engine.settled;
  Assert.equal(
    await nodesLike(store, `%${LIVE_HOST}%`),
    1,
    "a visit made after the instruction is a new visit, and is recorded"
  );
  Assert.ok(
    session.nodeForBrowser(tab.linkedBrowser),
    "and the tab is recording again, on a trail of its own"
  );

  BrowserTestUtils.removeTab(tab);
  // Leave the directory's shared database as this file found it.
  await store.forgetHost(LIVE_HOST);
});
