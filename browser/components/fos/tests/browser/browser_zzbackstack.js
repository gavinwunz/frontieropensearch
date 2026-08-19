/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * `back` and `forward` as one movement, reached by a word and by a gesture.
 *
 * Two things are under test and they are the same decision. The first is that
 * `back` walks a *cursor* rather than re-reading a visit log: the log version
 * appended its own move, so the second press found the page it had just left
 * and went there, and two presses returned you to where you started. The second
 * is that the browser's own back and forward now run this verb — rebound on
 * `BrowserCommands`, so the keys, the nav-bar buttons, the context menu, the
 * mouse's side buttons and the swipe all move the same way as the words.
 *
 * `browser_zzhistorygesture.js` covers what a traversal does to the *tree*, and
 * every assertion in it now runs through this path rather than through
 * `gBrowser.goBack`, which is the strongest statement available that the two
 * movements agree where they are supposed to. This file covers where they
 * differ: past a branch, and where the trail has nothing to say at all.
 */

const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";
const PAGE_C = "https://example.net/";
const PAGE_D = "https://example.com/d";

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
 * Take a step and wait for it to land.
 *
 * Not `browserLoaded`: a traversal that comes out of the bfcache fires no load
 * event, and waiting for one times out rather than failing — which reads as a
 * hung harness rather than a wrong answer.
 *
 * @param {string} direction `"back"` or `"forward"`.
 * @param {string} url Where it should land.
 */
async function step(direction, url) {
  const moved = BrowserTestUtils.waitForLocationChange(gBrowser, url);
  await session().walk(direction);
  await moved;
}

add_task(async function test_back_twice_goes_two_pages_back() {
  // The defect, stated as the thing a user would notice. Three pages, two
  // presses; the old `back` read the visit log after appending its own move to
  // it, so the second press went forward again and the third went back, for
  // ever, and the first page was unreachable by the word that exists to reach
  // it.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  const second = trail.currentNodeId;
  await goTo(PAGE_C);

  await step("back", PAGE_B);
  Assert.equal(trail.currentNodeId, second, "one step back is the page before");

  await step("back", PAGE_A);
  Assert.equal(
    trail.currentNodeId,
    first,
    "and the second step keeps going rather than turning round"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_forward_retraces_the_whole_walk() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  await goTo(PAGE_B);
  const second = trail.currentNodeId;
  await goTo(PAGE_C);
  const third = trail.currentNodeId;

  await step("back", PAGE_B);
  await step("back", PAGE_A);
  await step("forward", PAGE_B);
  Assert.equal(trail.currentNodeId, second, "forward retraced one step");

  await step("forward", PAGE_C);
  Assert.equal(trail.currentNodeId, third, "and then the other");

  Assert.equal(
    await trail.walk("forward"),
    false,
    "and stops at the present rather than inventing a step"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_stack_truncates_and_the_tree_does_not() {
  // The trade this fork can afford and no other browser can. Walking back and
  // navigating away drops the walked-past pages from the *stack*, exactly as
  // every browser does — and they are still nodes on the trail, so the thing
  // users actually complain about losing is not lost.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  const second = trail.currentNodeId;
  await goTo(PAGE_C);
  const third = trail.currentNodeId;

  await step("back", PAGE_B);
  await step("back", PAGE_A);
  await goTo(PAGE_D);

  Assert.equal(
    await trail.walk("forward"),
    false,
    "there is no forward: the walk ended where the new page began"
  );

  await step("back", PAGE_A);
  Assert.equal(
    trail.currentNodeId,
    first,
    "and back is the page the new one was opened from, not one walked through"
  );

  Assert.ok(trail.store.getNode(second), "the page walked past is still a node");
  Assert.ok(trail.store.getNode(third), "and so is the one past that");
  Assert.equal(
    trail.store.children(first).length,
    2,
    "the branch the stack dropped is a sibling in the tree, one mark away"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_marked_node_is_a_move_and_not_a_walk() {
  // `back <mark>` names a node, which is a new present rather than a step, so
  // it truncates what was ahead. The two forms share a word because they are
  // the same question — where do I want to be — and only the bare one is a
  // step through time.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  await goTo(PAGE_C);

  const moved = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  await trail.enter(first);
  await moved;

  Assert.equal(
    await trail.walk("forward"),
    false,
    "entering a node by name left nothing ahead to return to"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_gesture_runs_the_verb() {
  // The §5 claim, checked on the command rather than on the key: the manifest
  // classifies `Browser:Back` as reachable by the word `back`, and that is only
  // true if pressing it is this movement. Proved past a branch, where the
  // chain's answer and the trail's differ — the tab's history after re-entry is
  // one entry long, so a `gBrowser.goBack()` here would move nothing at all.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);
  const second = trail.currentNodeId;

  const reentered = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  await trail.enter(first);
  await reentered;
  await goTo(PAGE_C);
  const branched = trail.currentNodeId;
  Assert.equal(
    trail.store.children(first).length,
    2,
    "the tab is on a second branch of the first page"
  );

  const back = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  window.document.getElementById("Browser:Back").doCommand();
  await back;
  Assert.equal(
    trail.currentNodeId,
    first,
    "the gesture walked the trail back to the branch point"
  );

  const forward = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_C);
  window.document.getElementById("Browser:Forward").doCommand();
  await forward;
  Assert.equal(
    trail.currentNodeId,
    branched,
    "and forward returned along the same walk"
  );
  Assert.notEqual(
    trail.currentNodeId,
    second,
    "which is the branch the user was on, not the one the chain remembers"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_gesture_falls_through_when_the_trail_cannot() {
  // What stops the rebinding from being a removal. Forgetting deletes nodes
  // and leaves the tab's session history alone by design, so the page is still
  // there and the record of it is not. The chain still knows where back goes,
  // and a rebinding that answered "nowhere" would have made the most basic
  // gesture in the browser silently do nothing to keep a rule about words.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const first = trail.currentNodeId;
  await goTo(PAGE_B);

  trail.forget([first]);
  Assert.ok(!trail.store.getNode(first), "the first page was forgotten");
  Assert.equal(
    trail.canWalk("back"),
    false,
    "so the trail has no step to offer"
  );

  const back = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  window.document.getElementById("Browser:Back").doCommand();
  await back;
  Assert.ok(
    trail.store.getNode(trail.currentNodeId),
    "and the chain took the gesture, landing on a node that exists"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_traversable_node_is_traversed_to() {
  // Why the tab's chain survives being walked. `enter` replaces the whole
  // session history with one entry when it has to reach a node the chain
  // cannot represent — and it must not do that for the common case, or every
  // press of the most-used gesture in the browser would rebuild the tab from a
  // blob: no bfcache, a fresh load, and `history.length` stuck at 1 for content
  // that reads it.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  await goTo(PAGE_B);
  await goTo(PAGE_C);

  await step("back", PAGE_B);

  const history = gBrowser.selectedBrowser.browsingContext.sessionHistory;
  Assert.equal(history.count, 3, "the chain still has all three entries");
  Assert.equal(history.index, 1, "and the browser is standing in the middle");

  const length = await SpecialPowers.spawn(
    gBrowser.selectedBrowser,
    [],
    () => content.history.length
  );
  Assert.equal(length, 3, "so a page reading its own history sees three");

  BrowserTestUtils.removeTab(tab);
});
