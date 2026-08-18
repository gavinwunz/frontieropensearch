/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The context sidebar in a real chrome window.
 *
 * The arrangement is covered in node. What can only be seen here is that the
 * panel reads the *live* engine rather than a fixture — that pages browsed a
 * moment ago appear in it, that a row re-enters the page it names, and that
 * `what` opens it while still answering in a sentence.
 *
 * The crossing row gets the most attention of anything here, because it is the
 * claim the surface exists to make and it is the only one that needs two trails
 * to exist at once. A test that only ever browses one trail would pass with
 * that code deleted.
 */

const { FOSContextSidebar } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextSidebar.sys.mjs"
);
const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";

function sidebar() {
  return FOSContextSidebar.forWindow(window);
}

function engine() {
  return FOSContextEngine.forWindow(window);
}

function session() {
  return FOSTrailSession.forWindow(window);
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
 * Open the sidebar with everything the engine has written already visible.
 *
 * @returns {Promise<object>} The sidebar.
 */
async function openSettled() {
  await engine().settled;
  const panel = sidebar();
  await panel.open();
  // A second render, because the first was started before the queue we just
  // awaited had necessarily produced the rows it reads.
  await panel.render();
  return panel;
}

/**
 * Every rendered row of one section.
 *
 * @param {object} panel The sidebar.
 * @param {string} id A section id.
 * @returns {Element[]}
 */
function rowsOf(panel, id) {
  return [
    ...panel.body.querySelectorAll(`[data-section="${id}"] .fos-sidebar-row`),
  ];
}

registerCleanupFunction(() => {
  sidebar().close();
  bar().close();
  bar().dismissNotice();
});

add_task(async function test_the_panel_shows_what_was_browsed() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  const panel = await openSettled();

  ok(panel.isOpen, "the sidebar is open");
  const pages = rowsOf(panel, "pages");
  Assert.greaterOrEqual(pages.length, 2, "both pages are listed");

  const titles = pages.map(row =>
    row.querySelector(".fos-sidebar-label").getAttribute("title")
  );
  ok(titles.includes(PAGE_B), "the page just visited is one of them");

  // The panel and `what` make one claim from one string: the spoken sentence
  // names the context because speech has no heading, the shown one does not
  // because the heading above it is the name.
  const summary = panel.body.ownerDocument.querySelector(
    ".fos-sidebar-summary"
  );
  const spoken = await engine().summarise();
  ok(
    spoken.endsWith(summary.textContent),
    `the panel shows the sentence the engine reports, less its label ` +
      `(spoken "${spoken}", shown "${summary.textContent}")`
  );

  panel.close();
  ok(!panel.isOpen, "and it closes again");
});

add_task(async function test_what_opens_the_panel_and_still_answers() {
  sidebar().close();
  await goTo(PAGE_A);
  await engine().settled;

  // `run` is synchronous and hands back the handler's promise, so the answer
  // and the opening are both awaited through `result`.
  const outcome = bar().actions.run({ action: "what" });
  ok(outcome.ok, "`what` has a handler");
  const message = await outcome.result;

  ok(sidebar().isOpen, "`what` opened the sidebar");
  ok(message && message.length, "`what` still answered in a sentence");
  isnot(
    message,
    "The context engine could not answer that.",
    "and the answer is not the failure message"
  );
  sidebar().close();
});

add_task(async function test_a_row_re_enters_the_page_it_names() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  const panel = await openSettled();

  // Find the row for the page we are *not* on, so that entering it is a real
  // navigation and not a no-op that would pass either way.
  const target = rowsOf(panel, "pages").find(
    row =>
      row.querySelector(".fos-sidebar-label").getAttribute("title") === PAGE_A
  );
  ok(target, "the first page has a row");

  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    PAGE_A
  );
  target.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );
  await loaded;

  is(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_A,
    "clicking the row put that page back up"
  );
  panel.close();
});

add_task(async function test_a_page_on_two_trails_reports_the_crossing() {
  // The crossing row needs the same URL reached from two trails, which needs a
  // second tab: a trail is a tab in this build, and branching within one would
  // leave both nodes on the trail the panel excludes.
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  await engine().settled;

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  await goTo(PAGE_B);
  await engine().settled;

  const panel = await openSettled();
  const crossings = rowsOf(panel, "crossings");
  Assert.greaterOrEqual(
    crossings.length,
    1,
    "the second trail's arrival is reported"
  );

  const note = panel.body.querySelector(
    '[data-section="crossings"] .fos-sidebar-note'
  );
  ok(
    /reached this page from/.test(note.textContent),
    "and it says so in words"
  );

  // The row goes somewhere: it is the other trail's visit, not this one's.
  const row = crossings[0];
  ok(row.hasAttribute("data-enterable"), "the crossing row is enterable");

  panel.close();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_arrow_keys_skip_rows_that_go_nowhere() {
  await goTo(PAGE_A);
  const panel = await openSettled();

  panel.body.focus();
  EventUtils.synthesizeKey("KEY_ArrowDown", {}, window);

  const selected = panel.body.querySelector('[aria-selected="true"]');
  ok(selected, "an arrow key selects a row");
  ok(
    selected.hasAttribute("data-enterable"),
    "and it is never a row that cannot be entered"
  );
  is(
    panel.body.getAttribute("aria-activedescendant"),
    selected.id,
    "the listbox points assistive technology at it"
  );

  EventUtils.synthesizeKey("KEY_Escape", {}, window);
  ok(!panel.isOpen, "Escape closes the panel");
});

add_task(async function test_the_panel_and_the_rail_can_be_open_together() {
  const { FOSTrailRail } = ChromeUtils.importESModule(
    "resource:///modules/FOSTrailRail.sys.mjs"
  );
  await goTo(PAGE_A);
  const panel = await openSettled();
  const rail = FOSTrailRail.forWindow(window);
  rail.open();

  ok(panel.isOpen && rail.isOpen, "both surfaces are open");

  // They answer different questions and must not sit on top of each other:
  // the rail is inline-start, the sidebar inline-end.
  const railBox = rail.list.closest(".fos-rail").getBoundingClientRect();
  const panelBox = panel.body.closest(".fos-sidebar").getBoundingClientRect();
  ok(
    railBox.right <= panelBox.left || panelBox.right <= railBox.left,
    `they do not overlap (rail ${railBox.left}-${railBox.right}, ` +
      `panel ${panelBox.left}-${panelBox.right})`
  );

  rail.close();
  panel.close();
});

add_task(async function test_a_second_render_does_not_race_the_first() {
  await goTo(PAGE_A);
  const panel = sidebar();
  await panel.open();

  // Two renders in flight at once: the older must not paint over the newer.
  const first = panel.render();
  const second = panel.render();
  await Promise.all([first, second]);

  const sections = panel.body.querySelectorAll(".fos-sidebar-section");
  const ids = [...sections].map(section => section.dataset.section);
  is(
    new Set(ids).size,
    ids.length,
    `no section was drawn twice (${ids.join(", ")})`
  );
  panel.close();
});
