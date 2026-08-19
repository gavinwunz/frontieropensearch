/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * What the fork says is being asked for, while the asking is unanswered.
 *
 * The companion to `browser_zztransition.js`, under the same lens: not what
 * Firefox does to this fork's data, but what this fork writes into Firefox's.
 * That lens found `markPageAsTyped` missing; this is the next field along.
 *
 * `browser.userTypedValue` is a browser element's record of a request made and
 * not yet landed. `addTab` states the purpose better than any doc comment
 * does — *"pretend the user typed this so it'll be available till the document
 * successfully loads"* — and two things read it:
 *
 *   - the address bar, which shows it in place of the current URI with the
 *     page proxy state invalid, so the bar says where you are going rather
 *     than continuing to claim you are still where you were;
 *   - `TabState.collect`, which copies it into the session together with
 *     `userTypedClear`. When a load had started and not finished,
 *     `SessionStore._restoreTabEntry` reissues that load instead of restoring
 *     the history entry — so a browser killed mid-load comes back to the page
 *     that was asked for, not to the one it was leaving.
 *
 * `FOSActionDispatcher` replaced the address bar and went straight to
 * `browser.loadURI`, which writes none of this. So the fork spent every slow
 * load displaying the previous page's address as though nothing had been
 * requested, and every crash mid-load discarding the request entirely.
 *
 * The tests read the field synchronously, immediately after the bar has run a
 * line. That is not a shortcut around a race — it is the assertion. The write
 * has to happen before `loadURI` returns, because the setter resets the change
 * tracker that the progress listener raises at load start and reads at load
 * end to decide to clear the field again. Written afterwards, a fast load
 * leaves the request stranded on screen over the page that answered it.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs"
);
const { TabState } = ChromeUtils.importESModule(
  "resource:///modules/sessionstore/TabState.sys.mjs"
);

SearchTestUtils.init(this);

const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";

const TYPED_PAGE = `${FIXTURES}memex.html`;
const PICKED_PAGE = `${FIXTURES}nls.html`;
const LANDING_PAGE = `${FIXTURES}xanadu.html`;

/** A page that holds its body open, so a load in flight can be looked at. */
const SLOW_PAGE = `${FIXTURES}slow.sjs`;

/**
 * An initial page, chosen for being the dullest one on the list.
 *
 * `gInitialPages` is what the tab progress listener checks before deciding a
 * load is chrome's doing rather than the user's. Any entry would exercise that,
 * and `about:newtab` would be the obvious pick — but it is answered by a
 * content process that segfaults on this configuration (the same x11/24.04
 * family `browser_bfcache_exemption_about_pages.js` is skipped for), and a
 * crashed browser clears the field by a route that has nothing to do with what
 * is being tested. This one is a static blank document with no script.
 */
const BLANK_TAB = "chrome://browser/content/blanktab.html";

/** A local engine, so the result page is one mochitest is allowed to load. */
const SEARCH_ENGINE = "Frontier Pending Engine";
const SEARCH_BASE = `${FIXTURES}sourdough.html`;
const SEARCH_TERMS = "xanadu transclusion";

function bar() {
  return FOSCommandBar.forWindow(window);
}

function pending() {
  return gBrowser.selectedBrowser.userTypedValue;
}

/**
 * Run a line through the bar and hand back the load, unawaited.
 *
 * Unawaited on purpose: every assertion in this file is about the window
 * between the request and its answer, and awaiting the load first would close
 * that window before the test could look through it.
 *
 * @param {string} text The line to run.
 * @param {string} expectedURL The URL the line should land on.
 * @returns {Promise} Resolves when the page has loaded.
 */
function startLine(text, expectedURL) {
  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    url => url == expectedURL
  );
  bar().run(text);
  return loaded;
}

/**
 * Put the browser on a page by ordinary means, and wait for it.
 *
 * Deliberately not through the bar: every task needs somewhere to have come
 * *from*, and using the surface under test to get there would fold the
 * starting state into what is being asserted.
 *
 * @param {string} url Where to go.
 * @returns {Promise} Resolves once the page is there.
 */
async function goTo(url) {
  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    loadedURL => loadedURL == url
  );
  BrowserTestUtils.startLoadingURIString(gBrowser.selectedBrowser, url);
  await loaded;
}

add_setup(async function () {
  await SearchTestUtils.installSearchExtension(
    {
      name: SEARCH_ENGINE,
      search_url: SEARCH_BASE,
      search_url_get_params: "q={searchTerms}",
    },
    { setAsDefault: true }
  );
  // Somewhere to leave from, so "the bar still shows the old page" is a claim
  // with a page behind it rather than about:blank.
  await goTo(LANDING_PAGE);
});

registerCleanupFunction(async () => {
  bar().close();
  for (const url of [
    TYPED_PAGE,
    PICKED_PAGE,
    LANDING_PAGE,
    SLOW_PAGE,
    SEARCH_BASE,
  ]) {
    await PlacesUtils.history.remove(url);
  }
});

add_task(async function test_a_typed_url_is_pending_until_it_lands() {
  const before = pending();
  Assert.equal(before, null, "nothing is pending on a settled page");

  const loaded = startLine(TYPED_PAGE, TYPED_PAGE);
  Assert.equal(
    pending(),
    TYPED_PAGE,
    "the page asked for is pending from the moment it is asked for"
  );

  await loaded;
  await TestUtils.waitForCondition(
    () => pending() === null,
    "the request stops being pending once the page it asked for arrives"
  );
});

add_task(async function test_a_search_is_pending_as_the_words_not_the_url() {
  // The address bar's rule is one branch: the terms for a search, the URL for
  // a URL. Showing the result page's URL here would be showing the user a
  // string they never wrote, assembled from an engine template, while the
  // thing they did write is still the only description of what they want.
  const expected = `${SEARCH_BASE}?q=${encodeURIComponent(SEARCH_TERMS).replace(
    /%20/g,
    "+"
  )}`;
  const loaded = startLine(SEARCH_TERMS, expected);

  Assert.equal(
    pending(),
    SEARCH_TERMS,
    "a search is pending as the words that were searched for"
  );
  Assert.notEqual(
    pending(),
    expected,
    "and not as the result page's URL, which nobody typed"
  );

  await loaded;
  await TestUtils.waitForCondition(
    () => pending() === null,
    "the search stops being pending once its result page arrives"
  );
});

add_task(async function test_a_page_picked_off_a_list_is_pending_too() {
  // `openURL` is the dispatcher's other half — a row, a card, a suggestion,
  // where nobody typed the URL. `addTab` sets the field for exactly this case
  // and gives the reason in its own comment: the point is not to record typing,
  // it is to have something to show until the document arrives.
  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    url => url == PICKED_PAGE
  );
  bar().actions.openURL(PICKED_PAGE);

  Assert.equal(
    pending(),
    PICKED_PAGE,
    "a page picked off a list is pending as its own URL"
  );

  await loaded;
  await TestUtils.waitForCondition(
    () => pending() === null,
    "the picked page stops being pending once it arrives"
  );
});

add_task(async function test_the_address_bar_says_where_it_is_going() {
  // The half Firefox gets for free and this fork does not. Firefox's address
  // bar is the surface that was typed into, so it is already showing the
  // pending value before the field is written; this fork's is a display, and
  // nothing repaints it between the request and the location change that has
  // already cleared the request. Without the redraw the field would be set,
  // read by session store, and never once seen by the user.
  await goTo(LANDING_PAGE);

  const showing = gURLBar.value;
  Assert.ok(showing.includes("xanadu"), `the bar shows the page it is on`);

  const loaded = startLine(TYPED_PAGE, TYPED_PAGE);
  Assert.ok(
    gURLBar.value.includes("memex"),
    "the bar shows the page being asked for, not the one being left"
  );
  Assert.equal(
    gURLBar.getAttribute("pageproxystate"),
    "invalid",
    "and marks it as a request rather than a place, so no identity is claimed " +
      "for a page that has not loaded"
  );

  await loaded;
  await TestUtils.waitForCondition(
    () => gURLBar.value.includes("memex") && pending() === null,
    "the bar settles on the arrived page with nothing left pending"
  );
  Assert.equal(
    gURLBar.getAttribute("pageproxystate"),
    "valid",
    "and takes the identity back once there is a page to claim it for"
  );
});

add_task(async function test_the_session_would_restore_what_was_asked_for() {
  // The reason the field is worth writing even when nobody is looking at the
  // address bar. `TabState.collect` runs on a timer and at shutdown; if it
  // catches a tab mid-load it records the request alongside the stale entry,
  // and `_restoreTabEntry` prefers the request. So this collects at the one
  // moment that matters, which is the moment a crash would have to happen —
  // hence the fixture that holds its body open, and the wait for the flag the
  // progress listener raises at `STATE_START`.
  //
  // That wait is the point rather than a nuisance. `userTypedClear` is the
  // difference between two restores: 0 means the user typed and never pressed
  // enter, and session store writes the text back into the bar without loading
  // anything; 1 means the load had begun, and session store reissues it. Only
  // the second is what a dispatched line should come back as, and it is not
  // true at the instant of dispatch — it becomes true when the request goes
  // out. Collecting synchronously would assert the wrong one of the two.
  await goTo(LANDING_PAGE);

  const browser = gBrowser.selectedBrowser;
  const loaded = startLine(SLOW_PAGE, SLOW_PAGE);
  // Logged rather than asserted, because it is the reason the wait below
  // exists and not a claim worth pinning: at the instant of dispatch the page
  // is still the old one, the request is already pending, and the started-load
  // flag is still false.
  info(
    `on ${browser.currentURI.spec}, pending ${browser.userTypedValue}, ` +
      `started ${browser.didStartLoadSinceLastUserTyping()}`
  );
  await TestUtils.waitForCondition(
    () => browser.didStartLoadSinceLastUserTyping(),
    "the request went out and the page has not arrived"
  );

  const state = TabState.collect(gBrowser.selectedTab);
  Assert.equal(
    state.userTypedValue,
    SLOW_PAGE,
    "the session carries the page that was asked for, not just the one on screen"
  );
  Assert.equal(
    state.userTypedClear,
    1,
    "and records that its load had started, which is what makes session " +
      "restore reissue it rather than restore the entry underneath it"
  );

  await loaded;
});

add_task(async function test_an_initial_page_does_not_stay_pending() {
  // The carve-out that makes this a two-part change. The tab progress listener
  // does not raise the started-load flag for an initial page arriving over a
  // blank tab — chrome loads those by itself and must not wipe what a user was
  // in the middle of typing — and nothing else clears the pending value. So a
  // surface that writes the value without also declaring that the user asked
  // for this page leaves the request sitting in the address bar permanently,
  // over a page that finished loading: worse than the staleness the pending
  // value exists to fix. `initialPageLoadedFromUserAction` is the declaration,
  // and it is why this went in as one change rather than two.
  //
  // The clearing is asserted rather than the load, because the clearing *is*
  // the behaviour under test and it only happens after the load. Asserting the
  // attribute alone would be asserting the implementation — and briefly did:
  // with `about:newtab` as the fixture, removing the declaration failed only
  // that assertion, because the page's content process segfaults on this
  // configuration and a crashed browser clears the field by an unrelated
  // route. The static page below removes that second cause, and the wait then
  // fails too.
  await goTo("about:blank");
  const browser = gBrowser.selectedBrowser;

  bar().run(BLANK_TAB);
  Assert.equal(
    browser.userTypedValue,
    BLANK_TAB,
    "an initial page asked for by name is pending like anything else"
  );
  Assert.equal(
    browser.initialPageLoadedFromUserAction,
    BLANK_TAB,
    "and is marked as asked for, so the listener does not mistake it for " +
      "chrome loading a page over something the user was typing"
  );

  await TestUtils.waitForCondition(
    () => browser.userTypedValue === null,
    "an initial page stops being pending once it arrives, like any other page"
  );
});

/**
 * Giving up on a page that was asked for and has not come.
 *
 * The other half of the same field, and it had to exist the moment the first
 * half did. Firefox splits an abandon in two: Escape over the page runs
 * `Browser:Stop`, and Escape *in the address bar* runs `handleRevert`, which
 * nulls the pending value and repaints the bar with the page you are on. This
 * fork's address bar takes no focus, so `handleRevert` is unreachable from
 * anywhere in the build — and nothing in the grammar reached the other half
 * either, so a hands-free user could not abandon a load at all.
 *
 * The tests below therefore assert two different things and it is worth saying
 * which is which. That the pending value ends up cleared is largely Firefox's
 * own doing: the tab progress listener nulls it at `STATE_STOP` with a failure
 * status, for the reason its comment gives — *"restore the current document's
 * location in case the request was stopped before the location changed"*. What
 * is this fork's is that the state is correct *synchronously*, before that
 * event can arrive, and that a verb reaches it at all.
 */

/** `slow.sjs` holds its body for three seconds. */
const SLOW_DELAY_MS = 3000;

function notice() {
  return document.querySelector(".fos-report");
}

/**
 * Ask for the slow page and wait until the request has actually gone out.
 *
 * The wait is the difference between abandoning a request and abandoning a
 * load. Before `STATE_START` there is no channel to stop and the assertion
 * would pass on a browser that had done nothing at all.
 *
 * @returns {Promise<object>} The selected browser, mid-load.
 */
async function startSlowLoad() {
  await goTo(LANDING_PAGE);
  const browser = gBrowser.selectedBrowser;
  bar().run(SLOW_PAGE);
  Assert.equal(pending(), SLOW_PAGE, "the slow page is pending");
  await TestUtils.waitForCondition(
    () => browser.didStartLoadSinceLastUserTyping(),
    "the request went out and the page has not arrived"
  );
  return browser;
}

add_task(async function test_stop_gives_up_on_the_page_that_has_not_come() {
  const browser = await startSlowLoad();

  bar().run("stop");

  // Synchronously, which is the whole of what this fork adds. The progress
  // listener would get here too, one event round trip later and only if the
  // stop produced a failed `STATE_STOP` — which a request abandoned before its
  // channel opened never does.
  Assert.equal(pending(), null, "nothing is pending any more");
  Assert.ok(
    gURLBar.value.includes("xanadu"),
    `the bar says where you are again, not where you were going: ${gURLBar.value}`
  );
  Assert.equal(
    gURLBar.getAttribute("pageproxystate"),
    "valid",
    "and takes back the identity it withheld while the request was in flight"
  );
  Assert.equal(
    browser.currentURI.spec,
    LANDING_PAGE,
    "the browser never left the page it was on"
  );

  // The part that separates stopping from merely forgetting. The fixture's
  // body is three seconds behind its headers, so a verb that cleared the field
  // without aborting the channel would look identical to this one until the
  // page it gave up on arrived and navigated the window anyway.
  /* eslint-disable-next-line mozilla/no-arbitrary-setTimeout */
  await new Promise(resolve => setTimeout(resolve, SLOW_DELAY_MS + 1000));
  Assert.equal(
    browser.currentURI.spec,
    LANDING_PAGE,
    "and the abandoned page does not turn up later over whatever came next"
  );
  Assert.equal(pending(), null, "with nothing left pending behind it");
});

add_task(async function test_stop_names_what_it_gave_up_on() {
  await startSlowLoad();

  bar().run("stop");

  // Giving up has to be cheap, and it is only cheap if the request survives
  // being given up on. The user who stops a load that turns out to have been
  // nearly finished should be able to ask for it again from what is on screen
  // rather than from memory.
  const report = notice();
  Assert.ok(report && !report.hidden, "stopping is answered in a sentence");
  Assert.ok(
    report.textContent.includes(SLOW_PAGE),
    `and the sentence names what was dropped: ${report.textContent}`
  );
  Assert.equal(
    report.getAttribute("aria-live"),
    "polite",
    "spoken as well as shown, since a hands-free user is the reason this verb " +
      "exists"
  );
  bar().dismissNotice();
});

add_task(async function test_stop_with_nothing_loading_says_so() {
  await goTo(LANDING_PAGE);
  await TestUtils.waitForCondition(
    () => pending() === null,
    "the page has settled and nothing is pending"
  );

  bar().run("stop");

  const report = notice();
  Assert.ok(report && !report.hidden, "a verb that did nothing still answers");
  Assert.equal(
    report.textContent,
    "Nothing was loading.",
    "and says that nothing was there rather than reporting a success"
  );
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    LANDING_PAGE,
    "the settled page is not disturbed by being stopped"
  );
  bar().dismissNotice();
});

add_task(async function test_the_session_forgets_an_abandoned_request() {
  // The reason clearing the field matters even with nobody looking at the bar.
  // `_restoreTabEntry` prefers a pending request over the history entry
  // underneath it, so a request left behind by an abandoned load is a browser
  // that comes back from a crash loading the page its user gave up on.
  const browser = await startSlowLoad();

  const during = TabState.collect(gBrowser.selectedTab);
  Assert.equal(
    during.userTypedValue,
    SLOW_PAGE,
    "mid-load the session carries the request, as it should"
  );

  bar().run("stop");

  const after = TabState.collect(gBrowser.selectedTab);
  Assert.ok(
    !after.userTypedValue,
    `an abandoned request is not carried into the session: ${after.userTypedValue}`
  );
  Assert.equal(
    browser.currentURI.spec,
    LANDING_PAGE,
    "and what is left is the page that is actually there"
  );
});

add_task(async function test_the_stop_button_abandons_the_request_too() {
  // The nav-bar kept its stop button and Escape over the page is still
  // `key_stop`; both dispatch `Browser:Stop`. Two stops with different
  // outcomes would be a worse defect than the one the verb fixes and an
  // invisible one, since both routes look like they worked.
  const browser = await startSlowLoad();

  document.getElementById("Browser:Stop").doCommand();

  Assert.equal(
    pending(),
    null,
    "the request goes with the load however the load was stopped"
  );
  Assert.ok(
    gURLBar.value.includes("xanadu"),
    `and the bar says where you are: ${gURLBar.value}`
  );
  Assert.equal(
    browser.currentURI.spec,
    LANDING_PAGE,
    "on the page that was never left"
  );
});

add_task(async function test_abandoning_takes_the_declaration_with_it() {
  // `#markAsPending` writes two things, and giving up has to drop both.
  // `initialPageLoadedFromUserAction` is the claim that the user asked for this
  // initial page by name, which is how the pending value survives the tab
  // progress listener's carve-out for pages chrome loads by itself. The
  // listener deletes it at `STATE_START`, so ordinarily it is gone in a
  // millisecond — but a request abandoned before its load starts never reaches
  // `STATE_START`, and the claim would then outlive the request that justified
  // it and be read against whatever chrome loaded next over the blank tab.
  //
  // Both lines below run before the load can have started, which is what makes
  // this the case the deletion exists for rather than a restatement of what
  // the listener already does.
  await goTo("about:blank");
  const browser = gBrowser.selectedBrowser;

  bar().run(BLANK_TAB);
  Assert.equal(
    browser.initialPageLoadedFromUserAction,
    BLANK_TAB,
    "asking for an initial page by name declares that it was asked for"
  );

  bar().run("stop");

  Assert.ok(
    !browser.initialPageLoadedFromUserAction,
    `giving up withdraws the declaration too: ${browser.initialPageLoadedFromUserAction}`
  );
  Assert.equal(pending(), null, "along with the request it described");
  bar().dismissNotice();
});
