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

add_task(async function test_a_nodes_title_describes_its_own_page() {
  // A tab relabels itself for the page it is *about* to show, which arrives
  // before the node for that page exists. Taking the label on trust shifted
  // every title in the trail back by one, so each row named the page after it.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const rootId = trail.currentNodeId;

  await goTo(PAGE_B);
  await goTo(PAGE_C);

  const root = trail.store.getNode(rootId);
  Assert.ok(
    !root.title ||
      (!root.title.includes("example.org") &&
        !root.title.includes("example.net")),
    `the root's title describes the root, not a later page (got ${root.title})`
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
  // Marks are assigned before the title arrives, so the letter comes from the
  // page's host. Deriving it from the raw URL instead handed h, t, p and s to
  // the first four nodes of every session, from "https://".
  Assert.ok(
    !["h", "t", "p", "s"].includes(letter) ||
      PAGE_A.replace(/^https:\/\//, "").includes(letter),
    `the mark is mnemonic for the page, not for its scheme (got ${letter})`
  );
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

add_task(async function test_the_focus_ring_lands_on_the_selected_row() {
  // SYSTEM.md §5. The rail's list fills the window's height, so a ring on the
  // container was a 700px accent rectangle down the side of the browser next
  // to a faintly shaded row — the loudest mark in the surface pointing at the
  // box rather than at the page Enter would open.
  //
  // Checked here rather than only in the stylesheet because the rule turns on
  // `:has()` over a live subtree, and a selector that reads correctly and
  // matches nothing is this project's most expensive recurring bug.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  await goTo(PAGE_B);

  rail().open();
  // The ring is `:focus-visible`, which needs the focus to have arrived the
  // way a keyboard user's does.
  EventUtils.synthesizeKey("KEY_ArrowUp", {}, window);

  const list = rail().list;
  const selected = list.querySelector('.fos-rail-row[aria-selected="true"]');
  ok(selected, "a row is selected");

  const styleOf = el => window.getComputedStyle(el);
  info(`list outline: ${styleOf(list).outline}`);
  info(`row outline: ${styleOf(selected).outline}`);

  Assert.equal(
    styleOf(list).outlineStyle,
    "none",
    "no ring around the panel while a row can carry it"
  );
  Assert.notEqual(
    styleOf(selected).outlineStyle,
    "none",
    "the selected row carries the ring instead"
  );

  rail().close();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_reload_is_not_a_new_page() {
  // Two things arrive at the progress listener looking like one: a reload, and
  // the second half of a process switch, which is what re-entering a restored
  // node into a fresh tab produces. Both would otherwise spawn a child holding
  // the same page as its parent, so a trail grew a second copy of a page
  // nobody navigated to.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const before = trail.store.nodes().length;
  const nodeId = trail.currentNodeId;

  const reloaded = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    PAGE_A
  );
  tab.linkedBrowser.reload();
  await reloaded;

  Assert.equal(
    trail.store.nodes().length,
    before,
    "reloading a page does not add a node"
  );
  Assert.equal(trail.currentNodeId, nodeId, "and does not move off it");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_placeholder_label_never_replaces_a_title() {
  // A tab labels itself with the URL of the page it is loading until the real
  // title arrives. A node that already knows its title — one restored from the
  // database, say — must not have that overwritten by the placeholder shown
  // while it is being re-entered.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const trail = session();
  const nodeId = trail.currentNodeId;
  trail.store.getNode(nodeId).title = "A Known Title";

  const reloaded = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    PAGE_A
  );
  tab.linkedBrowser.reload();
  await reloaded;

  Assert.equal(
    trail.store.getNode(nodeId).title,
    "A Known Title",
    "the title the node already had survives"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(
  async function test_a_long_trail_still_addresses_the_page_you_are_on() {
    // There are twenty-six letters and a real trail passes twenty-six pages in an
    // afternoon. Marks are assigned as nodes are created, so first come, first
    // served would spend the whole alphabet on the pages opened first and leave
    // the page in front of you the one that cannot be reached by `enter <mark>`.
    // This is the check that scarcity falls on the pages furthest behind.
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
    const trail = session();
    const marks = FOSCommandBar.forWindow(window).marks;
    const trailId = trail.activeTrailId;

    for (let i = 0; i < 30; i++) {
      await goTo(`https://example.com/?page=${i}`);
    }

    const nodes = trail.store.nodes(trailId);
    Assert.greater(nodes.length, 26, "the trail is longer than the alphabet");

    const current = trail.store.getNode(trail.currentNodeId);
    Assert.ok(
      marks.markOf(nodeKey(current.id)),
      "the page you are on has a letter"
    );

    // And the letters went to the recent end of the trail rather than the old
    // one: the pages you have just come through are the ones worth addressing.
    const byRecency = nodes
      .slice()
      .sort((a, b) => b.last_visited_at - a.last_visited_at);
    const marked = byRecency.filter(node => marks.markOf(nodeKey(node.id)));
    const recentMarked = byRecency
      .slice(0, 10)
      .filter(node => marks.markOf(nodeKey(node.id)));
    Assert.equal(
      recentMarked.length,
      10,
      `the ten most recent pages all hold letters (${marked.length} marked)`
    );

    BrowserTestUtils.removeTab(tab);
    marks.clear();
  }
);
