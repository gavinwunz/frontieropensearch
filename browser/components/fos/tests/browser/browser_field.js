/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The Field in a real chrome window.
 *
 * The layout arithmetic is covered in node (`tests/node/test_fieldview.mjs`)
 * and the model's invariants in xpcshell (`tests/unit/test_field.js`); neither
 * is repeated here. What is here is everything those cannot see: that
 * navigation actually produces cards, that the key is really bound, that
 * `enter` puts a page back in the tab that owns its trail rather than in
 * whichever tab is in front, and that dismissal is lossless in the one
 * direction the whole pillar rests on.
 */

const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { FOSFieldSurface } = ChromeUtils.importESModule(
  "resource:///modules/FOSFieldSurface.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { LEVEL } = ChromeUtils.importESModule(
  "resource:///modules/FOSFieldView.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";
const PAGE_C = "https://example.net/";

function session() {
  return FOSTrailSession.forWindow(window);
}

function field() {
  return FOSFieldSurface.forWindow(window);
}

function bar() {
  return FOSCommandBar.forWindow(window);
}

/**
 * The most recently visited node for a URL, on one trail.
 *
 * Deliberately not `store.nodes().find(...)`: every file in this directory
 * shares one window, so nodes accumulate and a search across every trail
 * returns the *oldest* match — a node from a trail this test never touched,
 * which then has no card and no mark for reasons that have nothing to do with
 * what is being tested. The page these tests mean is the one they just opened.
 *
 * @param {string} url The page.
 * @param {?number} [trailId] The trail to look on, or the active one.
 * @returns {?object} A node, or undefined.
 */
function nodeOn(url, trailId = session().activeTrailId) {
  return session()
    .store.nodes(trailId)
    .filter(node => node.url === url)
    .sort((a, b) => b.last_visited_at - a.last_visited_at)[0];
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
  field().close();
});

add_task(async function test_one_key_toggles_page_and_field() {
  // The phase plan asks for a single gesture between the page and the Field,
  // and "show me every page I have open" is what the Field is for — so it
  // takes that command outright rather than growing a second overview beside
  // the one the tab strip already had.
  const key = window.document.getElementById("key_fosField");
  Assert.equal(
    key?.getAttribute("command"),
    "FOS:Field",
    "F2 is bound to the Field"
  );
  Assert.equal(key?.getAttribute("keycode"), "VK_F2", "and it is one key");

  window.document.getElementById("FOS:Field").doCommand();
  Assert.ok(field().isOpen, "the command opened the Field");
  Assert.equal(field().level, LEVEL.OVERVIEW, "and it opens at the overview");

  window.document.getElementById("Browser:ShowAllTabs").doCommand();
  Assert.ok(!field().isOpen, "and the same command closes it again");
});

add_task(async function test_navigation_produces_cards() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  const model = field().model;
  const nodeId = session().currentNodeId;
  Assert.notEqual(nodeId, null, "navigation produced a node");

  const card = model.cardForNode(nodeId);
  Assert.ok(card, "and the node has a card without the Field being opened");
  Assert.equal(
    card.region_id,
    session().store.getNode(nodeId).trail_id,
    "a region is a trail: the card landed in its own trail's region"
  );
  Assert.ok(!card.pinned, "a seeded card is not pinned; only the user pins");
});

add_task(async function test_the_overview_renders_every_region() {
  await goTo(PAGE_A);
  field().open();

  Assert.equal(field().level, LEVEL.OVERVIEW);
  const tiles = window.document.querySelectorAll(".fos-field-tile");
  Assert.equal(
    tiles.length,
    field()
      .model.regions()
      .filter(r => !r.nested).length,
    "one tile per top-level region"
  );

  // Property 1: the whole world is on screen. Every tile is inside the stage,
  // and there is nothing to scroll to.
  const stage = window.document.querySelector(".fos-field-stage");
  const bounds = stage.getBoundingClientRect();
  for (const tile of tiles) {
    const box = tile.getBoundingClientRect();
    Assert.lessOrEqual(box.right, bounds.right + 1, "a tile is on screen");
    Assert.lessOrEqual(box.bottom, bounds.bottom + 1, "a tile is on screen");
  }
  Assert.equal(stage.scrollWidth, stage.clientWidth, "nothing to pan to");

  field().close();
});

add_task(async function test_the_focus_ring_lands_on_the_focused_card() {
  // SYSTEM.md §5. The stage is the whole content area, so a ring on it framed
  // the window instead of pointing at anything. Live, because the rule it
  // replaced was overriding the UA's own ring rather than adding one.
  await goTo(PAGE_A);
  field().open();
  const trailId = session().activeTrailId;
  field().showRegion(trailId);

  const stage = window.document.querySelector(".fos-field-stage");
  stage.focus({ focusVisible: true });
  EventUtils.synthesizeKey("KEY_ArrowUp", {}, window);

  const focused = stage.querySelector(".fos-field-card[data-focus]");
  ok(focused, "a card has the focus");
  ok(stage.matches(":focus-visible"), "the stage holds a keyboard focus");
  is(
    window.getComputedStyle(stage).outlineStyle,
    "none",
    "no ring around the stage while a card can carry it"
  );
  is(
    parseFloat(window.getComputedStyle(focused).outlineWidth),
    parseFloat(
      window
        .getComputedStyle(window.document.documentElement)
        .getPropertyValue("--focus-outline-width")
    ),
    "the focused card's frame is widened to the ring's width"
  );

  field().close();
});

add_task(async function test_zoom_moves_between_the_three_levels() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  field().open();

  // The region of the trail this tab is actually on: `regions()[0]` is
  // whichever region was created first in the whole session, which is a
  // different thing as soon as more than one test file has run in the window.
  const trailId = session().activeTrailId;
  field().showRegion(trailId);
  Assert.equal(field().regionId, trailId, "a region is a trail");
  Assert.equal(field().level, LEVEL.REGION);
  Assert.greaterOrEqual(
    field().renderedCardIds.length,
    2,
    "the region level renders the trail's cards"
  );

  // Escape zooms out one level and only leaves the Field from the overview,
  // so it is never ambiguous about whether it will close something.
  const stage = window.document.querySelector(".fos-field-stage");
  EventUtils.synthesizeKey("KEY_Escape", {}, window);
  Assert.equal(field().level, LEVEL.OVERVIEW, "escape zoomed out");
  Assert.ok(field().isOpen, "and did not leave the Field");
  Assert.ok(stage, "the stage survives a level change");

  EventUtils.synthesizeKey("KEY_Escape", {}, window);
  Assert.ok(!field().isOpen, "a second escape leaves for the page level");
  Assert.equal(field().level, LEVEL.PAGE);
});

add_task(async function test_cards_carry_a_mark_a_title_and_a_shot() {
  await goTo(PAGE_A);
  field().open();
  field().showRegion(session().activeTrailId);

  const card = window.document.querySelector(".fos-field-card");
  Assert.ok(card, "a card is rendered");
  Assert.ok(
    card.querySelector(".fos-field-mark").textContent.trim(),
    "it shows its mark, which is how `enter cap` and typing c meet"
  );
  Assert.ok(
    card.querySelector(".fos-field-caption").textContent.trim(),
    "and its title, rendered rather than hidden behind a hover delay"
  );
  Assert.ok(card.querySelector(".fos-field-shot"), "and has a thumbnail slot");

  field().close();
});

add_task(async function test_the_verbs_are_wired() {
  // Every pillar reaches the bar the same way: register objects, register
  // verbs. A verb with no handler reports NOT_WIRED rather than falling
  // through to a web search, so this is the check that pillar A has landed.
  const unwired = bar().actions.unwired();
  for (const verb of ["field", "enter", "dismiss"]) {
    Assert.ok(!unwired.includes(verb), `${verb} has a handler`);
  }
});

add_task(async function test_enter_by_mark_from_the_command_bar() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  const model = field().model;
  const nodeA = nodeOn(PAGE_A);
  Assert.ok(model.cardForNode(nodeA.id), "the page is on the Field");
  // One page, one mark, and it belongs to the page rather than to the card —
  // so the same letter reaches it from the rail and from the Field.
  const mark = bar().marks.markOf(`node:${nodeA.id}`);
  Assert.ok(mark, "the page has a mark to be addressed by");

  // Not `browserLoaded`: the card's page is still an entry of this tab's own
  // chain, so `enter` traverses to it rather than replaying a stored blob —
  // and a page coming back out of the bfcache fires no load event.
  const landed = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  const outcome = bar().actions.run({
    action: "enter",
    target: mark,
    text: null,
  });
  Assert.ok(outcome.ok, "the verb ran");
  await landed;
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_A,
    "`enter <mark>` put that card's page back"
  );
  Assert.ok(!field().isOpen, "and left the Field for the page level");
});

add_task(async function test_enter_restores_into_the_tab_that_owns_the_trail() {
  // A tab is a trail, and the Field addresses every card in every region — so
  // entering a card from another trail has to select that trail's tab. Without
  // this the current tab is dragged onto a trail it was never on, taking its
  // page with it.
  await goTo(PAGE_A);
  const firstTab = gBrowser.selectedTab;
  const firstTrail = session().activeTrailId;

  const secondTab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    PAGE_C
  );
  Assert.notEqual(
    session().activeTrailId,
    firstTrail,
    "a new tab opened its own trail"
  );

  const nodeA = nodeOn(PAGE_A, firstTrail);
  const card = field().model.cardForNode(nodeA.id);

  await field().enterCard(card.id);
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab === firstTab,
    "the owning tab was selected"
  );
  Assert.equal(
    secondTab.linkedBrowser.currentURI.spec,
    PAGE_C,
    "and the other tab was left exactly where it was"
  );

  BrowserTestUtils.removeTab(secondTab);
});

add_task(async function test_dismiss_is_free_and_restore_is_lossless() {
  // §8, the one decision in the pillar that is not negotiable. If dismissal
  // were lossy nobody would dismiss, the Field would fill up, and the project
  // would have built one more surface to hoard on.
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  const model = field().model;
  const nodeB = nodeOn(PAGE_B);
  const card = model.cardForNode(nodeB.id);
  const mark = bar().marks.markOf(`node:${nodeB.id}`);

  Assert.ok(field().dismissCard(card.id), "the card was dismissed");
  Assert.equal(model.cardForNode(nodeB.id), null, "and left the Field");
  Assert.equal(
    session().store.getNode(nodeB.id).url,
    PAGE_B,
    "while the page stayed on its trail"
  );
  // The mark survives the dismissal, because it belongs to the page. That is
  // what makes §8's promise sayable: `enter <mark>` on a page you dropped is
  // how it comes back.
  Assert.equal(
    bar().marks.markOf(`node:${nodeB.id}`),
    mark,
    "the page kept its mark"
  );

  const back = model.restore(nodeB.id);
  Assert.ok(back, "and one call brings it back");
  Assert.equal(
    session().store.getNode(nodeB.id).dismissed_at,
    null,
    "with the node live again"
  );
});

add_task(async function test_a_drag_pins_and_never_overlaps() {
  // Properties 2 and 3 together, in the surface rather than the model: the
  // pointer path has to reach `moveCard`, and what it produces has to still
  // satisfy the non-occlusion invariant.
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  await goTo(PAGE_C);

  const model = field().model;
  field().open();
  field().showRegion(session().activeTrailId);
  Assert.greaterOrEqual(
    model.cardsIn(session().activeTrailId).length,
    2,
    "the trail has cards to push against"
  );

  const el = window.document.querySelector(".fos-field-card");
  const cardId = Number(el.dataset.cardId);
  const before = { ...model.getCard(cardId) };

  const box = el.getBoundingClientRect();
  EventUtils.synthesizeMouse(el, 5, 5, { type: "mousedown" }, window);
  EventUtils.synthesizeMouse(
    el,
    5 + box.width * 2,
    5 + box.height * 2,
    { type: "mousemove" },
    window
  );
  EventUtils.synthesizeMouse(
    el,
    5 + box.width * 2,
    5 + box.height * 2,
    { type: "mouseup" },
    window
  );

  const after = model.getCard(cardId);
  Assert.ok(after.pinned, "moving a card pins it: the user now owns it");
  Assert.ok(
    after.x !== before.x || after.y !== before.y,
    "and the card actually moved"
  );
  Assert.deepEqual(model.overlaps(), [], "no two cards overlap after a drag");
  assertNoRenderedOverlap();

  field().close();
});

add_task(async function test_a_drop_announces_the_position_once() {
  // The seam between pillar A and pillar C. The Field does not know what a
  // database is; it says where a card was put, and this is the saying. One
  // announcement per gesture, not one per pointer move — every move commits to
  // the model, and persisting each would record every position the card passed
  // through as though the user had chosen it.
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  const model = field().model;
  field().open();
  field().showRegion(session().activeTrailId);

  const seen = [];
  const off = field().onPlacement(p => seen.push(p));
  registerCleanupFunction(off);

  const el = window.document.querySelector(".fos-field-card");
  const cardId = Number(el.dataset.cardId);
  const box = el.getBoundingClientRect();
  EventUtils.synthesizeMouse(el, 5, 5, { type: "mousedown" }, window);
  for (const step of [1, 2]) {
    EventUtils.synthesizeMouse(
      el,
      5 + box.width * step,
      5 + box.height * step,
      { type: "mousemove" },
      window
    );
  }
  EventUtils.synthesizeMouse(
    el,
    5 + box.width * 2,
    5 + box.height * 2,
    { type: "mouseup" },
    window
  );

  Assert.equal(
    seen.length,
    1,
    "two pointer moves and one drop is one placement"
  );
  const card = model.getCard(cardId);
  Assert.deepEqual(
    seen[0],
    { nodeId: card.node_id, x: card.x, y: card.y },
    "and it is where the card came to rest, in field units"
  );

  off();
  field().close();
});

add_task(async function test_a_press_that_never_moved_announces_nothing() {
  // A click enters a card. It is not a placement, and writing a row for it
  // would turn every visit into a claim that the user arranged something.
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  field().open();
  field().showRegion(session().activeTrailId);

  const seen = [];
  const off = field().onPlacement(p => seen.push(p));
  const el = window.document.querySelector(".fos-field-card");
  EventUtils.synthesizeMouse(el, 5, 5, { type: "mousedown" }, window);
  EventUtils.synthesizeMouse(el, 5, 5, { type: "mouseup" }, window);
  off();

  Assert.deepEqual(seen, [], "a click is not an arrangement");
  field().close();
});

add_task(async function test_saved_positions_are_applied_to_the_real_surface() {
  // The restore half, against the surface rather than the model: FIELD.md §9's
  // "restart the browser" clause. A placement whose card is not on the Field
  // yet is held rather than dropped, so this does not depend on winning a race
  // with the sync that places it.
  await goTo(PAGE_A);
  await goTo(PAGE_B);

  const model = field().model;
  field().open();
  field().showRegion(session().activeTrailId);

  const card = model.cardsIn(session().activeTrailId)[0];
  const at = { x: 250, y: 180 };
  field().restorePlacements(new Map([[card.node_id, at]]));

  const restored = model.cardForNode(card.node_id);
  Assert.deepEqual(
    { x: restored.x, y: restored.y },
    at,
    "the card is where the previous session left it"
  );
  Assert.ok(restored.pinned, "and the system may not move it again");
  Assert.deepEqual(model.overlaps(), [], "with the invariant still holding");

  // A node with no card yet: held, then applied by the sync that places it.
  const pending = 999999;
  field().restorePlacements(new Map([[pending, { x: 10, y: 10 }]]));
  Assert.ok(!model.cardForNode(pending), "nothing was invented for it");

  field().close();
});

/**
 * A restart is revisitation, and revisitation is where a thumbnail pays.
 *
 * The Field's own snapshots live in memory, so before this every card in a
 * restored session was a grey rectangle with a caption — the condition Data
 * Mountain measured as its weakest, at the one moment PadPrints says the
 * picture is worth most. The fix is Gecko's own thumbnail store: written when
 * a page is departed, read when a card has no snapshot of its own.
 *
 * Both halves are asserted against the disk and against what is drawn, because
 * neither is visible to the model tests: whether the file is really written
 * depends on `shouldStoreThumbnail` agreeing about a live channel, and whether
 * `moz-page-thumb://` really paints in chrome depends on the protocol handler.
 */
add_task(async function test_visiting_a_page_stores_its_thumbnail() {
  // The mochitest profile turns page-thumbnail capturing off wholesale
  // (`testing/profiles/common/user.js`), which is exactly the machinery under
  // test here, so these two tasks turn it back on for their own duration.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.pagethumbnails.capturing_disabled", false]],
  });
  // No Field opened and no second page: browsing alone has to fill the store,
  // or a card restored tomorrow has nothing to show. This is what the settle
  // capture buys — the departure capture cannot be relied on for it, since the
  // outgoing browser has often already been swapped by the time it fires.
  await goTo(PAGE_A);

  await TestUtils.waitForCondition(
    () => IOUtils.exists(PageThumbs.getThumbnailPath(PAGE_A)),
    "the page reached the thumbnail store without the Field being opened"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_a_card_without_a_snapshot_paints_the_stored_one() {
  // A restored card is one with no in-memory snapshot and no browser to take
  // one from. Refusing every capture is that card exactly, and is the only way
  // to reach the fallback without restarting the browser mid-test.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.pagethumbnails.capturing_disabled", false]],
  });
  const captureTabPreviewThumbnail = PageThumbs.captureTabPreviewThumbnail;
  PageThumbs.captureTabPreviewThumbnail = async () => false;
  try {
    // A second visit to the same page: a new node, so nothing in the memory
    // cache is keyed to it, while the store already holds its picture.
    await goTo(PAGE_B);
    await goTo(PAGE_A);
    const nodeId = session().currentNodeId;
    field().open();
    field().showRegion(session().store.getNode(nodeId).trail_id);

    const shot = await TestUtils.waitForCondition(() => {
      const card = window.document.querySelector(
        `.fos-field-card[data-node-id="${nodeId}"] .fos-field-shot`
      );
      return card?.style.backgroundImage.includes("moz-page-thumb") && card;
    }, "the card with no snapshot of its own painted the stored thumbnail");

    Assert.ok(
      !shot.hasAttribute("data-empty"),
      "and it is no longer in the empty state"
    );
  } finally {
    PageThumbs.captureTabPreviewThumbnail = captureTabPreviewThumbnail;
    field().close();
    await SpecialPowers.popPrefEnv();
  }
});

/**
 * A burst of resize events is one render, not one render each.
 *
 * `render` rebuilds the stage from nothing, and a resize gesture fires its
 * event many times per frame. Measured on a crowded overview a rebuild is
 * around 15ms, so the unthrottled version spent a whole frame's budget several
 * times over producing pictures nobody ever saw. This is the behaviour that
 * fix rests on; `browser_zzfieldperf.js` holds the numbers.
 */
add_task(async function a_burst_of_resizes_does_its_work_once() {
  await goTo(PAGE_A);
  const surface = field();
  surface.open();
  await frame();

  const start = surface.resizePasses;
  for (let i = 0; i < 10; i++) {
    window.dispatchEvent(new Event("resize"));
  }
  Assert.equal(
    surface.resizePasses,
    start,
    "nothing happens in the event's own tick"
  );

  await frame();
  // The coalesced pass is scheduled on a frame, so it has run by the time the
  // frame after that one arrives.
  await frame();
  Assert.equal(
    surface.resizePasses,
    start + 1,
    "ten resize events produced one pass"
  );

  window.dispatchEvent(new Event("resize"));
  await frame();
  await frame();
  Assert.equal(
    surface.resizePasses,
    start + 2,
    "and a later resize is not swallowed by the one before it"
  );

  surface.close();
});

/**
 * A resize moves what is on screen; it does not build it again.
 *
 * The stage's own box is what the layout is computed from, so setting it is
 * the same input a window resize varies — and it varies it without a window
 * manager in the test, which is the difference between a measurement and a
 * flake. What makes the assertion worth anything is the comparison at the end:
 * the repositioned overview has to be indistinguishable from the rebuilt one,
 * because a faster path that draws something slightly different is not a
 * faster path, it is a second layout.
 */
add_task(
  async function a_resize_repositions_the_overview_rather_than_rebuilding() {
    await goTo(PAGE_A);
    await goTo(PAGE_B);
    const surface = field();
    surface.open();
    await frame();

    const stage = window.document.querySelector(".fos-field-stage");
    const tilesBefore = [
      ...window.document.querySelectorAll(".fos-field-tile"),
    ];
    const minisBefore = [
      ...window.document.querySelectorAll(".fos-field-mini"),
    ];
    Assert.greater(tilesBefore.length, 0, "there is a tile to reposition");
    Assert.greater(minisBefore.length, 0, "carrying a miniature to reposition");
    const before = overviewGeometry();
    // Snapshotted as strings, not read back off the elements later: the arrays
    // above hold the live nodes, so a comparison made afterwards would be
    // between each element and itself.
    const miniStylesBefore = minisBefore.map(el => el.style.cssText);

    const width = stage.clientWidth;
    stage.style.width = `${Math.round(width * 0.6)}px`;
    try {
      window.dispatchEvent(new Event("resize"));
      await frame();
      await frame();

      const tilesAfter = [
        ...window.document.querySelectorAll(".fos-field-tile"),
      ];
      const minisAfter = [
        ...window.document.querySelectorAll(".fos-field-mini"),
      ];
      Assert.ok(
        tilesAfter.length === tilesBefore.length &&
          tilesAfter.every((el, i) => el === tilesBefore[i]),
        "the tiles are the same elements, not new ones"
      );
      Assert.ok(
        minisAfter.length === minisBefore.length &&
          minisAfter.every((el, i) => el === minisBefore[i]),
        "and so are the miniatures"
      );

      const repositioned = overviewGeometry();
      Assert.notDeepEqual(repositioned, before, "the overview did move");

      // What makes the pass cheap, stated as a property rather than as a
      // timing: the scale is carried by one wrapper per region, so a resize
      // does not touch the miniatures at all however many of them there are.
      Assert.deepEqual(
        minisAfter.map(el => el.style.cssText),
        miniStylesBefore,
        "no miniature was written to — they are placed in field units"
      );
      Assert.ok(
        [...window.document.querySelectorAll(".fos-field-mininest")].every(
          el => el.style.transform
        ),
        "and every wrapper carries the scale that moved instead"
      );

      surface.render();
      Assert.deepEqual(
        overviewGeometry(),
        repositioned,
        "and a rebuild at the same size draws it in exactly the same places"
      );
    } finally {
      stage.style.width = "";
      surface.close();
    }
  }
);

/**
 * The refusal, on the difference that motivates it.
 *
 * A card the model has and the stage does not is not a scale problem, and the
 * reposition path may not invent an element to solve it. It says so and the
 * caller rebuilds — the check being that the stage catches up, since a path
 * that refused and left it stale would pass an element-identity test by doing
 * nothing at all.
 */
add_task(async function a_resize_rebuilds_when_the_model_has_moved_on() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  const surface = field();
  surface.open();
  await frame();

  const stage = window.document.querySelector(".fos-field-stage");
  const model = surface.model;
  const card = model.cardForNode(nodeOn(PAGE_B).id);
  const before = window.document.querySelectorAll(".fos-field-mini").length;

  // Straight at the model, so the surface is not told. This is the state the
  // refusal is about: what is drawn and what is true have come apart.
  Assert.ok(model.dismiss(card.id), "a card left the model behind the surface");
  Assert.equal(
    window.document.querySelectorAll(".fos-field-mini").length,
    before,
    "and the stage has not noticed"
  );

  const rebuildsBefore = surface.resizeRebuilds;
  try {
    stage.style.width = `${Math.round(stage.clientWidth * 0.6)}px`;
    window.dispatchEvent(new Event("resize"));
    await frame();
    await frame();

    Assert.equal(
      window.document.querySelectorAll(".fos-field-mini").length,
      before - 1,
      "the resize rebuilt, so the dismissed card is gone from the stage"
    );
    // And the counter saw it. Every other assertion about `resizeRebuilds` is
    // that it stayed at zero, which a counter that never counts would satisfy
    // too — this is the one that makes those mean something.
    Assert.equal(
      surface.resizeRebuilds - rebuildsBefore,
      1,
      "and the pass is counted as the rebuild it was"
    );
  } finally {
    stage.style.width = "";
    model.restore(nodeOn(PAGE_B).id);
    surface.render();
    surface.close();
  }
});

/**
 * What arrived while you were not looking, and what did not.
 *
 * The signal's whole claim is that it never fires for a page the user is
 * looking at, because a signal that lights on ordinary browsing is one people
 * learn to stop reading. So the interesting assertion is the negative one: a
 * foreground navigation, which places a card exactly like a background load
 * does, must leave the state alone.
 */
add_task(
  async function a_background_arrival_is_unseen_and_a_navigation_is_not() {
    const surface = field();
    surface.open();
    surface.close();
    Assert.ok(!surface.hasUnseen, "nothing is unseen just after a look");

    await goTo(PAGE_A);
    Assert.ok(
      !surface.hasUnseen,
      "the page the user navigated to is not an arrival — they are looking at it"
    );

    const tab = BrowserTestUtils.addTab(gBrowser, PAGE_B);
    try {
      await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE_B);
      await TestUtils.waitForCondition(
        () => surface.hasUnseen,
        "a page loaded in a tab that is not in front is unseen"
      );

      // Cleared by looking, which is the only thing that clears it: opening the
      // Field is what the state is for, so it is also what ends it.
      surface.open();
      Assert.ok(!surface.hasUnseen, "and opening the Field cleared it");
    } finally {
      surface.close();
      BrowserTestUtils.removeTab(tab);
    }
  }
);

/**
 * The state is watched, not polled.
 *
 * The Field owns the question and says nothing about how it is drawn; a
 * surface that wants to draw it subscribes. Both edges are checked because a
 * listener that only fires on the way up leaves the mark on screen for the
 * rest of the session.
 */
add_task(async function the_unseen_state_is_announced_on_both_edges() {
  const surface = field();
  surface.open();
  surface.close();

  const seen = [];
  const unwatch = surface.onUnseenChange(value => seen.push(value));
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE_C);
  try {
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE_C);
    await TestUtils.waitForCondition(() => seen.length, "the watcher was told");
    surface.open();
    Assert.deepEqual(
      seen,
      [true, false],
      "once on the way up, once on the way down"
    );

    // And not once per arrival: the state is binary, so a second background
    // page while the first is still unseen is not a second announcement.
    surface.close();
    const more = [];
    const unwatch2 = surface.onUnseenChange(value => more.push(value));
    try {
      const second = BrowserTestUtils.addTab(gBrowser, PAGE_B);
      await BrowserTestUtils.browserLoaded(second.linkedBrowser, false, PAGE_B);
      await TestUtils.waitForCondition(() => more.length, "the first arrival");
      const third = BrowserTestUtils.addTab(gBrowser, PAGE_C);
      await BrowserTestUtils.browserLoaded(third.linkedBrowser, false, PAGE_C);
      Assert.deepEqual(more, [true], "the second arrival said nothing new");
      BrowserTestUtils.removeTab(second);
      BrowserTestUtils.removeTab(third);
    } finally {
      unwatch2();
    }
  } finally {
    unwatch();
    surface.open();
    surface.close();
    BrowserTestUtils.removeTab(tab);
  }
});

/** One animation frame. */
function frame() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

/**
 * Where every box in the overview is, as strings.
 *
 * Read from the inline styles rather than from `getBoundingClientRect`, so
 * that a comparison is between what the two paths *wrote* and not between two
 * roundings of it.
 *
 * The wrappers are in here because a miniature's own box is in field units and
 * does not change with the window: all of the scale is on the wrapper, so a
 * probe that read only boxes would compare the two paths on the one thing
 * neither of them varies.
 *
 * @returns {string[]} One entry per tile, wrapper and miniature, in DOM order.
 */
function overviewGeometry() {
  return [
    ...window.document.querySelectorAll(
      ".fos-field-tile, .fos-field-mininest, .fos-field-mini"
    ),
  ].map(el => {
    const id = el.dataset.regionId ?? `node-${el.dataset.nodeId}`;
    const { left, top, width, height, transform } = el.style;
    return `${id} ${left} ${top} ${width} ${height} ${transform}`;
  });
}

/**
 * Property 3 where it can actually be violated: on screen.
 *
 * The model's `overlaps()` is authoritative about the boxes the model owns,
 * and it was green while the rendered cards overlapped anyway — a caption hung
 * below the box made every card taller than the rectangle the invariant had
 * been checked against, so cards a legal distance apart still covered each
 * other, and a click landed on the wrong one. An invariant about what the user
 * sees has to be asserted against what is drawn.
 */
function assertNoRenderedOverlap() {
  const cards = [...window.document.querySelectorAll(".fos-field-card")];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].getBoundingClientRect();
      const b = cards[j].getBoundingClientRect();
      const apart =
        a.right <= b.left + 0.5 ||
        b.right <= a.left + 0.5 ||
        a.bottom <= b.top + 0.5 ||
        b.bottom <= a.top + 0.5;
      Assert.ok(
        apart,
        `rendered cards ${cards[i].dataset.cardId} and ` +
          `${cards[j].dataset.cardId} do not overlap`
      );
    }
  }
}

/**
 * The dot says something arrived; the Field says which one.
 *
 * The boolean on its own only gets the user as far as a canvas of identical
 * cards, and then they have to find the arrival themselves — which is the
 * expensive half of coming back, not the cheap half. Iqbal and Horvitz logged
 * information workers tabbing through 7.5 windows in pursuit of the one they
 * had been alerted about, and 27% of suspensions leaving the prior window
 * unvisited for more than two hours. Their design guideline from that data is
 * "provide easy access to suspended task context, as thumbnails of the
 * suspended states" — which is the Field, so what is left to build is the
 * pointer into it. IDEAS.md, run 32.
 */
add_task(async function the_field_says_which_card_arrived() {
  const surface = field();
  surface.open();
  surface.close();
  Assert.equal(surface.arrivedNodes.size, 0, "a look clears the arrivals");

  await goTo(PAGE_A);
  Assert.ok(
    !surface.arrivedNodes.has(session().currentNodeId),
    "the page navigated to is not an arrival"
  );

  const tab = BrowserTestUtils.addTab(gBrowser, PAGE_C);
  try {
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE_C);
    await TestUtils.waitForCondition(
      () => surface.hasUnseen,
      "the arrival lit the signal"
    );

    const arrival = session().nodeForBrowser(tab.linkedBrowser);
    Assert.ok(
      surface.arrivedNodes.has(arrival),
      "and the Field knows which node it was"
    );

    // The half that could most easily have been got wrong: the boolean clears
    // on open, because opening the Field is what it asks for. This one must
    // survive that open, or the surface the dot sends you to would have
    // nothing to point at by the time you arrived.
    surface.open();
    Assert.ok(!surface.hasUnseen, "opening cleared the boolean, as before");
    Assert.ok(
      surface.arrivedNodes.has(arrival),
      "and the card is still marked, which is the whole point of opening"
    );

    // Drawn at both levels: the overview says which trail, the region says
    // which card.
    const tile = window.document.querySelector(".fos-field-tile[data-arrived]");
    Assert.ok(tile, "the overview marks the trail the arrival landed on");
    Assert.ok(
      window.document.querySelector(`.fos-field-mini[data-arrived]`),
      "and the miniature within it"
    );

    surface.showRegion(surface.model.cardForNode(arrival).region_id);
    Assert.ok(
      window.document.querySelector(".fos-field-card[data-arrived]"),
      "and the card itself, once the trail is open"
    );

    // Closing is the user saying they have looked.
    surface.close();
    Assert.equal(
      surface.arrivedNodes.size,
      0,
      "and closing the Field clears them"
    );
  } finally {
    surface.close();
    BrowserTestUtils.removeTab(tab);
  }
});

/**
 * Re-entry is a departure, and it is the departure this browser is built for.
 *
 * The progress listener cannot announce it: the load `enter` starts belongs to
 * the node being arrived at, so `#restoring` suppresses the departure there —
 * correctly, or the outgoing page's state would be written over the state
 * being replayed. That left the one way of leaving a page that this design
 * encourages above all others taking no picture of it. Branch, go back, branch
 * again, and every page you branched *from* stayed a grey rectangle while the
 * page you never left kept its snapshot. It is in
 * `agent/reports/demo-3-field-region.png`: three children of one search, all
 * grey, and the search itself not.
 *
 * `enter` is also the only departure that is not a race — nothing has started
 * to move, so the outgoing document is still live and still painted — which is
 * why the listener's promise is awaited here and nowhere else. Both halves are
 * asserted, because a notification that fires after the restore has begun is
 * worth no more than the one that never fired.
 */
add_task(async function test_re_entry_captures_the_page_it_leaves() {
  await goTo(PAGE_A);
  const parent = session().currentNodeId;
  await goTo(PAGE_B);
  const leaving = session().currentNodeId;

  const departures = [];
  let listenerFinished = false;
  const off = session().onDeparture(async (nodeId, browser) => {
    // Read inside the listener, not after: the claim is about what was in
    // front of the browser at the moment it was told, and by the time `enter`
    // returns the answer has changed either way.
    departures.push({ nodeId, url: browser.currentURI?.spec });
    await new Promise(resolve => window.setTimeout(resolve, 0));
    listenerFinished = true;
  });

  try {
    await session().enter(parent);
  } finally {
    off();
  }

  Assert.deepEqual(
    departures.map(d => d.nodeId),
    [leaving],
    "re-entry announced the page it left, once"
  );
  Assert.equal(
    departures[0].url,
    PAGE_B,
    "while its browser was still showing it"
  );
  Assert.ok(
    listenerFinished,
    "and `enter` waited for the capture before replaying the arrival"
  );
});

/**
 * A snapshot is only worth filing if it is of the document it was asked for.
 *
 * `captureTabPreviewThumbnail` awaits twice before any pixels exist, so a
 * capture fired from the ordinary navigation departure can have its document
 * swapped underneath it — and `drawSnapshot` then paints whatever is in front
 * of it and reports success. There is no error to catch: the failure is a
 * picture of the next page, filed against this node, over the top of a correct
 * one. Only the document's identity can tell the two apart.
 *
 * The stub below is that race made deterministic: it wins its await and loses
 * its document, which is the exact shape the guard exists for.
 */
add_task(async function test_a_snapshot_of_the_wrong_document_is_discarded() {
  await goTo(PAGE_C);
  const nodeId = session().currentNodeId;
  const browser = gBrowser.selectedBrowser;
  const shotFor = id =>
    window.document.querySelector(
      `.fos-field-card[data-node-id="${id}"] .fos-field-shot`
    );

  // Armed once. The navigation this stub starts is itself a departure, which
  // asks for another capture, which would start it again — the Field's own
  // machinery turns a re-entrant stub into a browser that never finishes
  // leaving the page.
  const real = PageThumbs.captureTabPreviewThumbnail;
  let armed = true;
  PageThumbs.captureTabPreviewThumbnail = async () => {
    if (!armed) {
      return false;
    }
    armed = false;
    BrowserTestUtils.startLoadingURIString(browser, PAGE_A);
    await BrowserTestUtils.browserLoaded(browser, false, PAGE_A);
    return true;
  };

  let swapped;
  try {
    // Opening the Field captures every tab for the node it is showing, which
    // is this node, through the stub above.
    field().open();
    field().showRegion(session().store.getNode(nodeId).trail_id);

    // The precondition, asserted rather than assumed: the card starts with
    // nothing, so anything it has afterwards came from the capture under test
    // and not from a snapshot it already had.
    Assert.ok(
      !shotFor(nodeId)?.style.backgroundImage,
      "the card has no snapshot before the capture resolves"
    );

    swapped = await TestUtils.waitForCondition(
      () => browser.currentURI?.spec === PAGE_A && browser,
      "the stub moved the browser to another document"
    );
  } finally {
    PageThumbs.captureTabPreviewThumbnail = real;
  }

  Assert.ok(swapped, "the race the guard exists for actually happened");
  Assert.ok(
    !shotFor(nodeId)?.style.backgroundImage,
    "and the picture of the wrong document was dropped rather than filed"
  );

  field().close();
});
