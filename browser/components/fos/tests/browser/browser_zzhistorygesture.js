/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Back and forward, which this fork inherited and never taught about trails.
 *
 * Pillar B replaces linear history with a tree, and every navigation that
 * commits spawns a child of the node you were on. A step through session
 * history commits a navigation too, and arrives on this path looking exactly
 * like a click — so before this file existed, pressing Back appended a copy of
 * the page you had come from *underneath* the page you were leaving, and made
 * the copy current. The tree grew a spine nobody browsed, one node per press,
 * and `up` walked it.
 *
 * Everything here is about a movement Firefox owns rather than one this fork
 * added, which is why it has to run in a real window: the signal being read is
 * the docshell's load command, and nothing outside Gecko produces it. The last
 * task is the reason the fix cannot live on `Browser:Back` — the page itself
 * can call `history.back()`, and no command hook sees that.
 */

const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";
const PAGE_C = "https://example.net/";

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
 * Run a session history gesture and wait for it to land.
 *
 * A traversal is not awaited with `browserLoaded`: a page coming back out of
 * the bfcache fires no load event, and waiting for one times out rather than
 * failing, which reads as a hung harness rather than a wrong answer.
 *
 * @param {string} commandId The command element to run.
 * @param {string} url Where it should land.
 */
async function gesture(commandId, url) {
  const moved = BrowserTestUtils.waitForLocationChange(gBrowser, url);
  window.document.getElementById(commandId).doCommand();
  await moved;
}

/**
 * The nodes of the trail the given node is on, oldest first.
 *
 * @param {number} nodeId Any node on the trail.
 * @returns {object[]} Its trail's nodes.
 */
function trailOf(nodeId) {
  const trail = session();
  return trail.store.nodes(trail.store.getNode(nodeId).trail_id);
}

add_task(async function test_back_moves_through_the_tree_rather_than_adding() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;

  await goTo(PAGE_B);
  const childId = trail.currentNodeId;
  Assert.equal(trailOf(rootId).length, 2, "two pages, two nodes");

  await gesture("Browser:Back", PAGE_A);

  Assert.equal(
    trail.currentNodeId,
    rootId,
    "back put the window on the node it had come from"
  );
  Assert.equal(
    trailOf(rootId).length,
    2,
    "and added nothing: going back is a move, not a visit"
  );
  Assert.equal(
    trail.store.getNode(childId).parent_id,
    rootId,
    "the page left behind is still the child it was"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_forward_returns_to_the_node_it_came_from() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  const childId = trail.currentNodeId;

  await gesture("Browser:Back", PAGE_A);
  await gesture("Browser:Forward", PAGE_B);

  Assert.equal(
    trail.currentNodeId,
    childId,
    "forward landed on the node that page already had"
  );
  Assert.equal(trailOf(rootId).length, 2, "and still added nothing");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_back_twice_reaches_the_root() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  await goTo(PAGE_C);

  await gesture("Browser:Back", PAGE_B);
  await gesture("Browser:Back", PAGE_A);

  Assert.equal(trail.currentNodeId, rootId, "two steps back reached the root");
  Assert.equal(
    trailOf(rootId).length,
    3,
    "three pages are still three nodes, not five"
  );
  Assert.equal(
    trail.store.getNode(rootId).parent_id,
    null,
    "and the root is still the root"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_click_after_a_back_still_spawns_a_child() {
  // The rule the fix must not break. A link back to the page above you is a
  // real visit and stays one; only a history traversal is a move. This is why
  // the signal is the load command and never the URL.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);

  await gesture("Browser:Back", PAGE_A);
  await goTo(PAGE_C);

  const afterId = trail.currentNodeId;
  Assert.equal(
    trail.store.getNode(afterId).parent_id,
    rootId,
    "navigating from where back left us spawned a child there"
  );
  Assert.equal(
    trailOf(rootId).length,
    3,
    "which is a new node, because a visit is a visit"
  );
  Assert.equal(
    trail.store.children(rootId).length,
    2,
    "so the root now has two children and the forward branch survives"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_going_back_to_a_reused_entry_is_still_a_move() {
  // Navigating away from a mid-history position drops every entry above it.
  // The map has to drop them too, or a later step lands on the node of a page
  // that is no longer in this browser's history at all.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  await gesture("Browser:Back", PAGE_A);
  await goTo(PAGE_C);
  const freshId = trail.currentNodeId;

  await gesture("Browser:Back", PAGE_A);
  Assert.equal(trail.currentNodeId, rootId, "back still reaches the root");

  await gesture("Browser:Forward", PAGE_C);
  Assert.equal(
    trail.currentNodeId,
    freshId,
    "and forward reaches the page that replaced the old branch, not the old one"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_page_calling_history_back_is_a_move_too() {
  // The reason this cannot be a hook on `Browser:Back`. Content reaching for
  // its own history produces the same load command and no command event at
  // all, so a fix bound to the gesture would have left the tree corrupted by
  // any page with a "go back" link on it.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);

  const moved = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  await SpecialPowers.spawn(gBrowser.selectedBrowser, [], () => {
    content.history.back();
  });
  await moved;

  Assert.equal(
    trail.currentNodeId,
    rootId,
    "the page took itself back and the window moved with it"
  );
  Assert.equal(trailOf(rootId).length, 2, "adding nothing");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_re_entry_still_works_after_a_traversal() {
  // Re-entry replaces the whole session history with one entry, so the map
  // this fix keeps has to be rebuilt at that moment. If it were not, the stale
  // index would answer for the new history and a later back would land on a
  // node from the trail the user had left.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  const childId = trail.currentNodeId;
  await gesture("Browser:Back", PAGE_A);

  const back = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_B);
  await trail.enter(childId);
  await back;

  Assert.equal(trail.currentNodeId, childId, "re-entry put us on the node");
  Assert.equal(
    trailOf(rootId).length,
    2,
    "and the tree is the two nodes it always was"
  );

  await goTo(PAGE_C);
  const onwardId = trail.currentNodeId;
  Assert.equal(
    trail.store.getNode(onwardId).parent_id,
    childId,
    "navigating on from a re-entered node spawns a child of it"
  );

  // The step that proves the rebuild happened. Until this navigation there was
  // nothing to go back *to* — a re-entered tab has a one-entry history — so a
  // map still describing the history from before re-entry is invisible. Here
  // the first entry is the re-entered node, and a map that had not been
  // rebuilt would send this back to the node the tab was on an hour ago.
  await gesture("Browser:Back", PAGE_B);
  Assert.equal(
    trail.currentNodeId,
    childId,
    "back after re-entry reaches the node that was re-entered"
  );
  Assert.equal(
    trailOf(rootId).length,
    3,
    "and the tree is the three nodes those pages earned"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_forgotten_node_does_not_answer_for_its_entry() {
  // Forgetting deletes nodes and leaves the tab's session history alone — the
  // page stays on screen, only the record of it goes. So an entry can outlive
  // the node it stood for, and a traversal onto it must not put the window on
  // an id the store has dropped: everything downstream reads the current node
  // back out of the store, and would find nothing there.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);

  trail.forget([rootId]);
  Assert.ok(!trail.store.getNode(rootId), "the first page was forgotten");

  await gesture("Browser:Back", PAGE_A);

  Assert.ok(
    trail.store.getNode(trail.currentNodeId),
    "back landed the window on a node that exists"
  );
  Assert.notEqual(
    trail.currentNodeId,
    rootId,
    "and not on the one that was deleted"
  );

  BrowserTestUtils.removeTab(tab);
});
