/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * What this fork writes into *Firefox's* database, rather than its own.
 *
 * Every other test here asks what Firefox does to the Context Engine's data.
 * This one asks the reverse, and it is the direction nothing had ever checked:
 * the fork replaced the address bar with a command bar, and Places records a
 * visit differently depending on which piece of chrome asked for the load.
 *
 * The mechanism is `nsINavHistoryService.markPageAsTyped`, whose own comment
 * says it plainly: "If this is not called visits will be marked as
 * TRANSITION_LINK." Firefox calls it from the address bar
 * (`UrlbarUtils.addToUrlbarHistory`), the history menu, the history sidebar
 * and the places organiser — every surface where the chrome, not a page, asked
 * for a URL. `FOSActionDispatcher` is this fork's only such surface and it is
 * the one the fork wrote itself.
 *
 * Why the difference is not cosmetic, in this fork's own terms: the frecency
 * SQL (`SQLFunctions.cpp`) weights a typed visit at veryHigh/high and a link
 * visit one tier below at high/medium. `FOSPlacesFloor` — the command bar's
 * fifth tier — ranks by exactly that column, and deliberately takes Places'
 * ordering rather than inventing one. So a fork that never marks typed spends
 * every session quietly demoting the pages its user asked for by name, and
 * then reads the demoted ranking back into its own suggestion list.
 *
 * The search half is the same fact from the other side. Firefox marks a search
 * typed too, and relies on the visit's *source* to keep the boost off the
 * result page: the frecency SQL excludes `v.source IN (1, 3)`, and source 3 is
 * set from the `triggeringSearchEngine` attribute the tab browser puts on the
 * browser element. Marking typed without that attribute would not be a
 * half-fix, it would over-rank every result page above the pages found from
 * it — so the two go in together or neither does.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { KIND_SEARCH, resolveInput } = ChromeUtils.importESModule(
  "resource:///modules/FOSActions.sys.mjs"
);
const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs"
);

SearchTestUtils.init(this);

const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";

const TYPED_PAGE = `${FIXTURES}memex.html`;
const PICKED_PAGE = `${FIXTURES}nls.html`;
const PRIVATE_PAGE = `${FIXTURES}xanadu.html`;

/** A local engine, so the result page is one mochitest is allowed to load. */
const SEARCH_ENGINE = "Frontier Test Engine";
const SEARCH_BASE = `${FIXTURES}sourdough.html`;
const SEARCH_TERMS = "memex associative trails";

const TRANSITION_TYPED = Ci.nsINavHistoryService.TRANSITION_TYPED;
const TRANSITION_LINK = Ci.nsINavHistoryService.TRANSITION_LINK;

function bar() {
  return FOSCommandBar.forWindow(window);
}

/**
 * Every visit Places holds for a URL, oldest first.
 *
 * Read straight out of the database rather than through a history query,
 * because `visit_type` is the whole subject and the query APIs project it
 * away.
 *
 * @param {string} url
 * @returns {Promise<object[]>} `{type, source}` per visit.
 */
async function visits(url) {
  const connection = await PlacesUtils.promiseDBConnection();
  const rows = await connection.executeCached(
    `SELECT v.visit_type AS type, v.source AS source
     FROM moz_historyvisits v
     JOIN moz_places h ON h.id = v.place_id
     WHERE h.url = :url
     ORDER BY v.visit_date ASC`,
    { url }
  );
  return rows.map(row => ({
    type: row.getResultByName("type"),
    source: row.getResultByName("source"),
  }));
}

/**
 * Wait until Places has written at least one visit for a URL.
 *
 * The load resolving says the document arrived; the visit is written on
 * another thread afterwards, so a test that reads the database the moment
 * `browserLoaded` settles reads it too early about one time in three.
 *
 * @param {string} url
 * @returns {Promise<object[]>} The visits, once there is one.
 */
async function visitRecorded(url) {
  let found = [];
  await TestUtils.waitForCondition(async () => {
    found = await visits(url);
    return !!found.length;
  }, `Places recorded a visit for ${url}`);
  return found;
}

/**
 * Run a line through the bar the way a keystroke does, and await the load.
 *
 * @param {string} text The line to type.
 * @param {string} expectedURL The URL the line should land on.
 */
async function runLine(text, expectedURL) {
  const commandBar = bar();
  commandBar.open();
  const input = commandBar.input;
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));

  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    url => url == expectedURL
  );
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  await loaded;
}

/**
 * Open a private window and wait for it to be usable.
 *
 * Not `BrowserTestUtils.openNewBrowserWindow({private: true})`, which never
 * returns on this configuration — `browser_zzprivate.js` carries the same
 * helper and the reason.
 *
 * @returns {Promise<object>} The window.
 */
async function openPrivateWindow() {
  let started;
  const startedUp = new Promise(resolve => {
    started = resolve;
  });
  const observer = { observe: subject => started(subject) };
  Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  let win;
  try {
    win = window.OpenBrowserWindow({ private: true });
    await startedUp;
  } finally {
    Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
  }
  await TestUtils.waitForCondition(
    () => FOSContextEngine.forWindow(win).store,
    "the private window finished attaching"
  );
  return win;
}

registerCleanupFunction(async () => {
  bar().close();
  for (const url of [TYPED_PAGE, PICKED_PAGE, PRIVATE_PAGE]) {
    await PlacesUtils.history.remove(url);
  }
});

add_task(async function test_a_typed_url_is_recorded_as_typed() {
  await PlacesUtils.history.remove(TYPED_PAGE);

  await runLine(TYPED_PAGE, TYPED_PAGE);

  const recorded = await visitRecorded(TYPED_PAGE);
  Assert.equal(recorded.length, 1, "one visit for the page");
  Assert.equal(
    recorded[0].type,
    TRANSITION_TYPED,
    `a URL typed into the one entry surface is a typed visit, not ` +
      `${recorded[0].type == TRANSITION_LINK ? "a link visit" : recorded[0].type}`
  );
});

add_task(async function test_a_page_picked_off_a_list_is_recorded_as_typed() {
  // `openURL` is the other half of the dispatcher: a row, a card or a
  // suggestion, where nobody typed the URL. Firefox marks these typed too —
  // the history sidebar and the address bar's own history rows both do — and
  // for the same reason: the chrome asked for the page, no page linked to it.
  await PlacesUtils.history.remove(PICKED_PAGE);

  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    url => url == PICKED_PAGE
  );
  Assert.ok(bar().actions.openURL(PICKED_PAGE), "the load was asked for");
  await loaded;

  const recorded = await visitRecorded(PICKED_PAGE);
  Assert.equal(recorded.length, 1, "one visit for the page");
  Assert.equal(
    recorded[0].type,
    TRANSITION_TYPED,
    "a page picked off a list is a typed visit"
  );
});

add_task(async function test_a_search_carries_its_engine_to_places() {
  // A result page is marked typed like everything else, and is kept off the
  // typed frecency boost by its *source* — which Places reads from an
  // attribute the load has to carry. Without it the fork would rank every
  // result page above the pages it found from that page.
  //
  // A local engine, because the shipped default's host is not reachable under
  // mochitest and the point is to watch a real result page be recorded.
  // Unloaded and un-defaulted by the cleanup `installSearchExtension`
  // registers for us; doing it here as well double-unloads the extension.
  await SearchTestUtils.installSearchExtension(
    { name: SEARCH_ENGINE, search_url: SEARCH_BASE },
    { setAsDefault: true }
  );

  const resolved = resolveInput(SEARCH_TERMS);
  Assert.equal(resolved?.kind, KIND_SEARCH, "the line resolves to a search");
  const resultPage = resolved.uri.spec;
  Assert.ok(
    resultPage.startsWith(SEARCH_BASE),
    `fixup used the installed engine, got ${resultPage}`
  );
  await PlacesUtils.history.remove(resultPage);

  const browser = gBrowser.selectedBrowser;
  const loaded = BrowserTestUtils.browserLoaded(
    browser,
    false,
    url => url == resultPage
  );
  bar().actions.openQuery(SEARCH_TERMS);

  Assert.equal(
    browser.getAttribute("triggeringSearchEngine"),
    SEARCH_ENGINE,
    "the browser carries the engine that answered the line"
  );
  Assert.equal(
    browser.getAttribute("triggeringSearchEngineURL"),
    resultPage,
    "and the result page it will be recorded against"
  );

  await loaded;
  const recorded = await visitRecorded(resultPage);
  Assert.equal(
    recorded[0].type,
    TRANSITION_TYPED,
    "the result page is a typed visit like any other line run in the bar"
  );
  Assert.equal(
    recorded[0].source,
    Ci.nsINavHistoryService.VISIT_SOURCE_SEARCHED,
    "but its source is the search, which is what withholds the typed weight"
  );

  await PlacesUtils.history.remove(resultPage);
});

add_task(async function test_an_ordinary_load_clears_the_search_attribute() {
  // The attribute lives on the browser element, not on the load, so a search
  // followed by a plain URL would file the URL under the last engine used if
  // nothing cleared it. `_updateTriggerMetadataForLoad` clears it when no
  // engine is passed — this asserts the fork actually reaches that branch
  // rather than passing an object with a falsy field, or none at all.
  const browser = gBrowser.selectedBrowser;
  browser.setAttribute("triggeringSearchEngine", "left over");
  browser.setAttribute("triggeringSearchEngineURL", "https://example.com/old");

  await runLine(TYPED_PAGE, TYPED_PAGE);

  Assert.ok(
    !browser.hasAttribute("triggeringSearchEngine"),
    "a URL is not attributed to whatever was searched for last"
  );
  Assert.ok(
    !browser.hasAttribute("triggeringSearchEngineURL"),
    "and neither is its result page"
  );
});

add_task(async function test_a_private_window_does_not_mark_the_profile() {
  // The typed hint is not private state. It is one in-memory set keyed by URL
  // spec with a fifteen-minute life, so a private window that marks a page and
  // an ordinary window that visits the same page a moment later would between
  // them write a typed visit into the profile's database on the strength of
  // private browsing. Nothing else in this fork's private-browsing story would
  // catch it: no row is written by the private window itself.
  await PlacesUtils.history.remove(PRIVATE_PAGE);

  const win = await openPrivateWindow();
  try {
    const privateBar = FOSCommandBar.forWindow(win);
    const loaded = BrowserTestUtils.browserLoaded(
      win.gBrowser.selectedBrowser,
      false,
      url => url == PRIVATE_PAGE
    );
    privateBar.actions.openQuery(PRIVATE_PAGE);
    await loaded;
    Assert.equal(
      (await visits(PRIVATE_PAGE)).length,
      0,
      "the private visit itself is not in the profile's database"
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }

  // Now the same page, ordinarily, from a page rather than from the bar — the
  // one case where a leaked hint would be visible.
  const browser = gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, PRIVATE_PAGE);
  await BrowserTestUtils.browserLoaded(browser, false, PRIVATE_PAGE);

  const recorded = await visitRecorded(PRIVATE_PAGE);
  Assert.equal(
    recorded[0].type,
    TRANSITION_LINK,
    "an ordinary visit stays an ordinary visit after a private window typed it"
  );
});
