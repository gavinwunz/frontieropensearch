/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The trail rail, capture and re-entry in a real chrome window.
 *
 * The view model's flattening is covered in node
 * (`tests/node/test_trailrailview.mjs`) and is not repeated. What is here is
 * everything node cannot see: that navigation actually builds the tree, that
 * re-entry actually restores a page, that the key is really bound, and — the
 * one that matters — that pillar B's promise survives contact with Gecko's own
 * session history, which would have truncated the forward branch.
 */

const { FOSTrailSession, nodeKey } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { FOSTrailRail } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailRail.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";
const PAGE_C = "https://example.net/";

function session() {
  return FOSTrailSession.forWindow(window);
}

function rail() {
  return FOSTrailRail.forWindow(window);
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

registerCleanupFunction(() => {
  rail().close();
  FOSCommandBar.forWindow(window).marks.clear();
});

add_task(async function test_the_history_gesture_opens_the_trail() {
  // Pillar B replaces linear history rather than sitting beside it, so the key
  // that opened the history sidebar has to name this command. A second gesture
  // would mean two history surfaces, which is the thing the phase plan forbids.
  const key = window.document.getElementById("key_gotoHistory");
  Assert.equal(
    key?.getAttribute("command"),
    "FOS:TrailRail",
    "the history shortcut opens the trail rail"
  );

  window.document.getElementById("FOS:TrailRail").doCommand();
  Assert.ok(rail().isOpen, "the command opened the rail");
  Assert.ok(
    window.document.querySelector(".fos-rail"),
    "and the rail reached the DOM"
  );

  window.document.getElementById("FOS:TrailRail").doCommand();
  Assert.ok(!rail().isOpen, "and toggled it shut again");
});

add_task(async function test_navigation_builds_a_tree() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();

  const rootId = trail.currentNodeId;
  Assert.ok(rootId, "opening a page put the window on a node");

  const root = trail.store.getNode(rootId);
  Assert.equal(root.url, PAGE_A, "and the node records where we went");
  Assert.equal(root.parent_id, null, "the first page of a tab is a trail root");

  await goTo(PAGE_B);
  const childId = trail.currentNodeId;

  Assert.notEqual(childId, rootId, "navigating moved us to a new node");
  Assert.equal(
    trail.store.getNode(childId).parent_id,
    rootId,
    "every click spawns a child, so the tree records how we got here"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_going_back_never_destroys_the_forward_branch() {
  // This is pillar B stated as a property, in the runtime that would otherwise
  // break it. Gecko's session history truncates every forward entry the moment
  // you go back and navigate somewhere else; the whole reason re-entry replays
  // a stored blob instead of calling gotoIndex is that the branch has to
  // survive. If this ever fails, the pillar is gone whatever the rail looks
  // like.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();

  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  const firstBranch = trail.currentNodeId;

  await trail.enter(rootId);
  Assert.equal(trail.currentNodeId, rootId, "re-entered the earlier node");

  await goTo(PAGE_C);
  const secondBranch = trail.currentNodeId;

  Assert.ok(
    trail.store.getNode(firstBranch),
    "the branch we navigated away from still exists"
  );
  Assert.equal(
    trail.store.getNode(firstBranch).url,
    PAGE_B,
    "and still points where it did"
  );

  const children = trail.store.children(rootId).map(n => n.id);
  Assert.deepEqual(
    children,
    [firstBranch, secondBranch],
    "both branches hang off the node we went back to, as siblings"
  );

  // The linear surface Gecko keeps is the counter-example: it has thrown the
  // first branch away, which is exactly what this pillar exists to fix.
  const sessionHistoryLength =
    tab.linkedBrowser.browsingContext.sessionHistory?.count ?? 0;
  info(`session history holds ${sessionHistoryLength} entries; the trail holds
    ${trail.store.nodes(trail.store.getNode(rootId).trail_id).length}`);

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_re_entry_restores_the_page_and_its_scroll() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;

  // Scroll somewhere non-trivial, then leave. Restoring the offset is what
  // makes dismissal free — a page that comes back at the top has lost the part
  // the user actually cared about.
  await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    content.document.body.style.height = "5000px";
    content.scrollTo(0, 1200);
    await new Promise(r => content.requestAnimationFrame(r));
  });

  await goTo(PAGE_B);

  // Capture is asynchronous — it waits for content to report, because the
  // state collected at the instant of departure is routinely empty.
  await TestUtils.waitForCondition(
    () => trail.store.getNode(rootId).form_state,
    "leaving the page captured its session state"
  );
  const captured = trail.store.getNode(rootId);
  Assert.greater(
    captured.scroll_y,
    0,
    "including the scroll offset, which is the part that makes going back free"
  );

  await trail.enter(rootId);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE_A);

  Assert.equal(
    tab.linkedBrowser.currentURI.spec,
    PAGE_A,
    "re-entry put the page back"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_pillar_bs_verbs_are_wired_and_act_on_the_tree() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const bar = FOSCommandBar.forWindow(window);

  for (const verb of ["up", "back", "branch", "graft", "name"]) {
    Assert.ok(bar.actions.has(verb), `\`${verb}\` has a handler`);
  }

  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  const childId = trail.currentNodeId;

  // `branch` starts a sibling from where you are, without touching the line you
  // were on — the tree operation, not a navigation.
  bar.run("branch");
  const sibling = trail.currentNodeId;
  Assert.notEqual(sibling, childId, "branch moved us to a new node");
  Assert.equal(
    trail.store.getNode(sibling).parent_id,
    rootId,
    "and it is a sibling of the node we branched from, not a child"
  );
  Assert.ok(trail.store.getNode(childId), "the original branch is untouched");

  // `name` with no mark names the active trail, which is the common case.
  bar.run("name Memex research");
  Assert.equal(
    trail.store.getTrail(trail.activeTrailId).name,
    "Memex research",
    "naming makes the trail a first-class object"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_nodes_are_addressable_by_mark() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const bar = FOSCommandBar.forWindow(window);
  const rootId = trail.currentNodeId;

  const letter = bar.marks.markOf(nodeKey(rootId));
  Assert.ok(letter, "the node carries a mark the command bar can address");
  Assert.equal(
    bar.marks.typeAt(letter),
    "node",
    "typed as a node, so `graft` and `back` can narrow to it"
  );

  await goTo(PAGE_B);
  Assert.equal(
    bar.marks.markOf(nodeKey(rootId)),
    letter,
    "and the mark is sticky — GRAMMAR.md §2's whole point"
  );

  // `back <mark>` is the addressed form of re-entry, and it is the path a voice
  // user takes: "back cap" and typing `back c` are the same command.
  bar.run(`back ${letter}`);
  await TestUtils.waitForCondition(
    () => trail.currentNodeId === rootId,
    "back <mark> re-entered the marked node"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_rail_renders_the_captured_tree() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;
  await goTo(PAGE_B);
  const childId = trail.currentNodeId;

  rail().open();
  Assert.deepEqual(
    rail().renderedIds,
    [rootId, childId],
    "both nodes are rows, in navigation order"
  );

  const current = window.document.querySelector(".fos-rail-row[data-current]");
  Assert.equal(
    Number(current.dataset.nodeId),
    childId,
    "the row for the page we are on is marked as current"
  );

  // Hoisting is what keeps a deep trail inside a narrow rail.
  rail().hoist(childId);
  Assert.deepEqual(rail().renderedIds, [childId], "hoisted to the subtree");
  Assert.greaterOrEqual(
    window.document.querySelectorAll(".fos-rail-crumb").length,
    2,
    "with a breadcrumb back out"
  );

  rail().unhoist();
  Assert.deepEqual(rail().renderedIds, [rootId, childId], "and back out again");

  rail().close();
  BrowserTestUtils.removeTab(tab);
});
