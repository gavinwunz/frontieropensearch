/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * When `enter` resolves, and why the answer is the commit rather than the load.
 *
 * `enter` used to resolve once it had *asked* for a node. The word read as "was
 * entered" and meant "was requested", and the gap between the two was a race
 * that every caller had to know about and handle for itself: a navigation
 * started on top of a traversal that has not committed arrives first and is
 * then overwritten by the restore landing behind it. Six tests hit it in a
 * single run and every one of them reported as a timeout somewhere else in the
 * file, which is what an unstated contract costs to debug.
 *
 * So the verb now resolves on the landing. Two decisions come with that and
 * both are under test here.
 *
 * THE LANDING IS THE COMMIT. `onSettled` already means "the page finished
 * loading" and this deliberately fires earlier, because the thing being waited
 * for is narrower: the traversal stops being pending the moment the location
 * has changed, and from there a fresh navigation is an ordinary navigation
 * rather than a race with a restore still on its way. Waiting for the stop
 * event too would make every `back` cost a whole page load before the next
 * command in the same line could run, and prevent no defect at all —
 * `test_the_landing_is_the_commit_and_not_the_load` is that difference made
 * observable, against a fixture whose headers arrive at once and whose body
 * takes three seconds.
 *
 * THE WAIT IS BOUNDED. A promise that depends on the network can be left
 * pending by a server that never answers, and a verb that never resolves is a
 * worse failure than the race it replaced. The bound never changes the answer:
 * `enter` reports whether the node was *entered*, and a node whose page is slow
 * was still entered — a `back` that reported failure while the page it asked
 * for was visibly loading would be lying about the one thing the user can see.
 */

const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";
const PAGE_C = "https://example.net/";
const PAGE_D = "https://example.com/d";

const SLOW_PAGE =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/slow.sjs";

/** Long enough for any local page to commit, short of the verb's own bound. */
const PATIENCE_MS = 4000;

function session() {
  return FOSTrailSession.forWindow(window);
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
 * Whether a promise resolves before we run out of patience.
 *
 * The bound is what this is really asking about: `LANDING_MS` is longer than
 * `PATIENCE_MS`, so a re-entry that was left pending resolves *late* rather
 * than never, and a plain `await` would pass on it. Racing a timer is the only
 * way to tell "landed" from "gave up", and the margin is wide because the
 * landing being measured is a local page committing.
 *
 * @param {Promise} promise The promise under test.
 * @returns {Promise<boolean>} Whether it won the race.
 */
function settlesPromptly(promise) {
  let timer;
  const patience = new Promise(resolve => {
    // The delay is the measurement, not a guess at how long something takes:
    // the failure being ruled out is a promise that resolves *late*, and no
    // event is fired by a wait running out its bound. The rule is guarding
    // against sleeping instead of listening, and there is nothing to listen to.
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    timer = setTimeout(() => resolve(false), PATIENCE_MS);
  });
  return Promise.race([promise.then(() => true), patience]).then(won => {
    clearTimeout(timer);
    return won;
  });
}

add_task(async function test_enter_resolves_after_a_traversal_has_committed() {
  // The contract, on the cheap path: a node still in the tab's own chain is
  // reached by traversing to it. Reading the URI the instant `enter` resolves
  // is the whole assertion — under the old contract it was still the page
  // being left, because all that had happened was a `gotoIndex` being asked
  // for.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);

  Assert.equal(await trail.enter(first), true, "the node was entered");
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_A,
    "and the page was already there when the verb said so"
  );
  Assert.equal(trail.currentNodeId, first, "standing on the node it named");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_enter_resolves_after_a_restore_has_committed() {
  // The same contract on the other path, which is a different mechanism and
  // not a second spelling of the first: a node the chain has thrown away is
  // replayed as a one-entry tab state through SessionStore rather than
  // traversed to, so nothing about the traversal's timing carries over.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const root = trail.currentNodeId;
  await goTo(PAGE_B);
  const dropped = trail.currentNodeId;

  // Back to the root and away again: PAGE_B is now a branch the chain does not
  // hold, which is what forces the restore rather than the traversal.
  await trail.enter(root);
  await goTo(PAGE_C);

  Assert.equal(
    await trail.enter(dropped),
    true,
    "the dropped node was entered"
  );
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_B,
    "and its page was already there when the verb said so"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_navigation_after_enter_is_not_overtaken() {
  // The defect the contract exists to remove, stated as the thing a user would
  // do: go back, then go somewhere else. Under the old contract the second
  // navigation started while the traversal was still in flight, the restore
  // landed behind it, and the window ended up on the page it had been asked to
  // leave — with the tree recording a walk nobody made.
  //
  // This is also every chained line in the grammar: `back a` followed by
  // anything that loads is exactly this shape.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  await goTo(PAGE_C);

  await trail.enter(first);
  await goTo(PAGE_D);

  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_D,
    "the window is on the page asked for after the re-entry"
  );
  const children = trail.store.children(first).map(n => n.url);
  Assert.deepEqual(
    children.sort(),
    [PAGE_B, PAGE_D].sort(),
    "and the branch was recorded under the node that was re-entered"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_landing_is_the_commit_and_not_the_load() {
  // `slow.sjs` sends its headers at once and holds its body for three seconds,
  // so committing and finishing are far enough apart to tell which one the verb
  // is waiting for. Re-entered off the chain deliberately: a traversal to a
  // node still in the chain can come back out of the bfcache with no load at
  // all, and then there would be nothing to be early for.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const root = trail.currentNodeId;
  await goTo(SLOW_PAGE);
  const slow = trail.currentNodeId;
  await trail.enter(root);
  await goTo(PAGE_C);

  const browser = gBrowser.selectedBrowser;
  const loaded = BrowserTestUtils.browserLoaded(browser, false, SLOW_PAGE);
  let finished = false;
  loaded.then(() => {
    finished = true;
  });

  Assert.equal(
    await settlesPromptly(trail.enter(slow)),
    true,
    "the re-entry landed rather than running out its bound"
  );
  Assert.equal(
    browser.currentURI.spec,
    SLOW_PAGE,
    "the location had committed"
  );
  Assert.equal(finished, false, "and the body had not arrived yet");

  await loaded;
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_second_re_entry_settles_the_first() {
  // One browser holds one pending landing, so a second `enter` has to do
  // something about the first. Settling it is the honest reading — that
  // traversal is no longer in flight, something else is — and dropping it
  // instead would leave whoever awaited it hanging until the bound, which is
  // the failure this whole contract was written to stop being possible.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  const second = trail.currentNodeId;
  await goTo(PAGE_C);

  const superseded = trail.enter(first);
  const winner = trail.enter(second);

  Assert.equal(
    await settlesPromptly(superseded),
    true,
    "the re-entry that was overtaken still resolved"
  );
  Assert.equal(
    await settlesPromptly(winner),
    true,
    "and so did the one that overtook it"
  );

  BrowserTestUtils.removeTab(tab);
});
