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
