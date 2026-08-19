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

add_task(async function test_a_page_reports_the_questions_it_provoked() {
  // The other direction of the crossing, and it needs the same two-trail setup
  // for the same reason plus one more: a question asked in the context the
  // panel is describing is already listed under "Questions asked", so this
  // section is deliberately empty until the question comes from another
  // enquiry. Asking on one tab and reading on another is the shortest way to
  // be in that state.
  await goTo(PAGE_A);
  await engine().settled;

  // Recorded rather than typed, for the reason browser_contextengine.js gives:
  // typing a prose query would send the default engine a live request.
  const raw = "vannevar bush associative trails";
  engine().recordQuery(raw);
  // The question's landing page, which is what its row will re-enter.
  await goTo(PAGE_B);
  await engine().settled;
  const asking = gBrowser.selectedTab;
  // Moved off the answer again, so that entering the row is a navigation and
  // not a no-op that would pass either way.
  await goTo(PAGE_A);
  await engine().settled;

  // A second tab is a second trail and so a second context, which is what puts
  // the question outside the context the panel will be describing.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  await engine().settled;

  const panel = await openSettled();
  const provoked = rowsOf(panel, "provoked");
  Assert.greaterOrEqual(
    provoked.length,
    1,
    "the page reports what it provoked"
  );

  const labels = provoked.map(
    row => row.querySelector(".fos-sidebar-label").textContent
  );
  ok(labels.includes(raw), "and it is the question that was typed here");

  const row = provoked[labels.indexOf(raw)];
  ok(
    row.hasAttribute("data-enterable"),
    "the row is live, because the question reached a page"
  );

  // It goes to where the question *landed*, not back to the page it was asked
  // from — which is the page already on screen. That page is on the trail the
  // question was asked on, so `enter` restores it into the tab that owns that
  // trail rather than dragging this one onto it: the load to wait for is the
  // asking tab's, not the selected one's.
  const entered = BrowserTestUtils.browserLoaded(
    asking.linkedBrowser,
    false,
    PAGE_B
  );
  row.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );
  await entered;
  Assert.equal(
    gBrowser.selectedTab,
    asking,
    "entering an answer on another trail goes to that trail's tab"
  );
  Assert.equal(
    asking.linkedBrowser.currentURI.spec,
    PAGE_B,
    "the row re-enters the page the question opened"
  );

  panel.close();
  BrowserTestUtils.removeTab(tab);
});

add_task(
  async function test_a_question_asked_here_and_now_is_not_shown_twice() {
    // The exclusion, from the other side: a question in this context is a few
    // rows further down the same panel, and a surface that says a thing twice in
    // one screen is a surface the user stops reading.
    await goTo(PAGE_A);
    await engine().settled;

    const raw = "hypertext and transclusion";
    engine().recordQuery(raw);
    await goTo(PAGE_B);
    await engine().settled;
    await goTo(PAGE_A);
    await engine().settled;

    const panel = await openSettled();
    const provoked = rowsOf(panel, "provoked").map(
      row => row.querySelector(".fos-sidebar-label").textContent
    );
    ok(
      !provoked.includes(raw),
      "the question is not repeated above the section that already lists it"
    );

    const asked = rowsOf(panel, "questions").map(
      row => row.querySelector(".fos-sidebar-label").textContent
    );
    ok(asked.includes(raw), "and it is still listed there");

    panel.close();
  }
);

add_task(async function test_the_panel_opens_on_the_page_you_are_on() {
  // The rail opens with the current node selected; this panel opening with
  // nothing selected meant the two surfaces disagreed about what a selection
  // is, and left the focus ring with nowhere to go but around the panel.
  await goTo(PAGE_A);
  const panel = await openSettled();

  const selected = panel.body.querySelector('[aria-selected="true"]');
  ok(selected, "a row is selected the moment the panel opens");
  ok(selected.hasAttribute("data-current"), "and it is the page you are on");

  panel.close();
});

add_task(async function test_arrow_keys_skip_rows_that_go_nowhere() {
  await goTo(PAGE_A);
  const panel = await openSettled();

  panel.body.focus({ focusVisible: true });
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

  // SYSTEM.md §5: the ring goes on the row, not around a panel that fills the
  // window. Asserted live rather than in the stylesheet because the rule it
  // replaced was overriding the UA's own `outline: auto` rather than adding a
  // ring, so simply deleting it left the container ringed anyway.
  ok(panel.body.matches(":focus-visible"), "the body holds a keyboard focus");
  is(
    window.getComputedStyle(panel.body).outlineStyle,
    "none",
    "no ring around the panel while a row can carry it"
  );
  isnot(
    window.getComputedStyle(selected).outlineStyle,
    "none",
    "the selected row carries the ring instead"
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

// ---- the merge offer ------------------------------------------------------

/**
 * Open the panel with a merge offer standing in for the model's verdict.
 *
 * The offer itself needs the embedding weights, which no ordinary run has, so
 * the real `mergeOffer` is exercised by `agent/jobs/run39.sh` against a real
 * engine and what is doubled here is only *that a candidate was found*. That
 * split is deliberate and is the lesson `browser_voice.js` taught the hard
 * way: a double is a claim about an API, so this one is kept to a value this
 * file also asserts the shape of, and the arithmetic behind the value is
 * tested in node where no double is involved at all.
 *
 * @param {number} contextId The context to offer merging with.
 * @param {?string} label Its name.
 * @returns {Promise<object>} The sidebar, rendered with the offer.
 */
async function openOffering(contextId, label) {
  const live = engine();
  const real = live.mergeOffer;
  live.mergeOffer = async () => ({ contextId, label, score: 0.31 });
  registerCleanupFunction(() => {
    live.mergeOffer = real;
  });
  const panel = await openSettled();
  return panel;
}

/**
 * A second trail, so that a second context exists to be merged with.
 *
 * @returns {Promise<{tab: object, contextId: number}>}
 */
async function secondEnquiry() {
  // Release any pin an earlier file in this suite left behind. Every file here
  // shares one window, and `context <mark>` is a statement that deliberately
  // outlives the navigation that follows it — so a pinned context makes
  // `activeContextId` stop tracking the trail, and a test that opens a tab to
  // get a second context silently gets the first one back. Passed alone this
  // file was green; the suite is where it showed.
  await bar().actions.run({ action: "context", target: null, text: null })
    .result;
  const first = engine().activeContextId;
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_B);
  await engine().settled;
  const contextId = engine().activeContextId;
  Assert.notEqual(contextId, first, "a second tab is a second context");
  return { tab, contextId, first };
}

add_task(async function test_no_offer_means_no_section() {
  // The ordinary case on a machine with no weights: the panel is exactly what
  // it was before this feature, rather than carrying an empty question.
  await goTo(PAGE_A);
  const panel = await openSettled();
  is(rowsOf(panel, "merge").length, 0, "nothing asks anything");
  panel.close();
});

add_task(async function test_an_offer_asks_and_offers_both_answers() {
  await goTo(PAGE_A);
  const { tab } = await secondEnquiry();
  const panel = await openOffering(4242, "Memex reading");

  const rows = rowsOf(panel, "merge");
  is(rows.length, 2, "a question has two answers");
  ok(
    /Memex reading/.test(
      panel.body.querySelector('[data-section="merge"] .fos-sidebar-note')
        .textContent
    ),
    "and it names the other enquiry"
  );
  ok(
    rows.every(row => row.hasAttribute("data-enterable")),
    "both answers are reachable by the one gesture the panel has"
  );

  // The offer leads. A question that has to be scrolled to is asked badly.
  const sections = [...panel.body.querySelectorAll("[data-section]")];
  is(sections[0].dataset.section, "merge", "and it is asked first");

  panel.close();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_accepting_makes_the_two_contexts_one() {
  await goTo(PAGE_A);
  const { tab, contextId, first } = await secondEnquiry();

  const panel = await openOffering(first, "The first enquiry");
  const before = engine().activeContextId;
  is(before, contextId, "standing in the second enquiry");

  const [accept] = rowsOf(panel, "merge");
  accept.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );

  // Not `await engine().settled`: accepting is deliberately *not* on the
  // recording queue. That queue exists so a navigation never waits on the
  // database, and this is not a navigation — it is a thing the user just asked
  // for and is watching. So the test waits for the effect instead.
  const survivor = Math.min(first, contextId);
  await TestUtils.waitForCondition(
    () => engine().activeContextId === survivor,
    "the merge lands"
  );

  // Derived state, recomputed: the trail the user is on now resolves to the
  // context that survived, which is the earlier of the two.
  is(
    engine().activeContextId,
    survivor,
    "the enquiry that started first is the one that survives"
  );

  const store = await FOSContextEngine.store();
  const listed = (await store.contexts()).map(row => row.id);
  ok(!listed.includes(Math.max(first, contextId)), "the other is not offered");

  panel.close();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_declining_is_permanent() {
  await goTo(PAGE_A);
  const { tab, contextId, first } = await secondEnquiry();

  const panel = await openOffering(first, "The first enquiry");
  const [, decline] = rowsOf(panel, "merge");
  decline.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );

  const store = await FOSContextEngine.store();
  const low = Math.min(first, contextId);
  const high = Math.max(first, contextId);
  let declined;
  await TestUtils.waitForCondition(async () => {
    declined = await store.declinedMerges();
    return declined.has(`${low}:${high}`);
  }, "the refusal is written down");
  ok(declined.has(`${low}:${high}`), "the refusal is written down");

  // And the real chooser honours it, which is the half a stubbed offer cannot
  // show: `bestMerge` is what reads the declined set.
  const { bestMerge } = ChromeUtils.importESModule(
    "resource:///modules/FOSContextMerge.sys.mjs"
  );
  is(
    bestMerge({
      activeId: contextId,
      activeVectors: [[1, 0, 0]],
      candidates: [{ id: first, label: "x", vectors: [[1, 0, 0]] }],
      declined,
    }),
    null,
    "so an identical pair is never offered again"
  );

  panel.close();
  BrowserTestUtils.removeTab(tab);
});
