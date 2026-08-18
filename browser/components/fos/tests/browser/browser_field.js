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
  const nodeA = session()
    .store.nodes()
    .find(node => node.url === PAGE_A);
  Assert.ok(model.cardForNode(nodeA.id), "the page is on the Field");
  // One page, one mark, and it belongs to the page rather than to the card —
  // so the same letter reaches it from the rail and from the Field.
  const mark = bar().marks.markOf(`node:${nodeA.id}`);
  Assert.ok(mark, "the page has a mark to be addressed by");

  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    PAGE_A
  );
  const outcome = bar().actions.run({
    action: "enter",
    target: mark,
    text: null,
  });
  Assert.ok(outcome.ok, "the verb ran");
  await loaded;
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

  const nodeA = session()
    .store.nodes()
    .find(node => node.url === PAGE_A && node.trail_id === firstTrail);
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
  const nodeB = session()
    .store.nodes()
    .find(node => node.url === PAGE_B);
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
