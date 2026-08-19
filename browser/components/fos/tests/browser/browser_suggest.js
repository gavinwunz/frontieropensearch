/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Ranked suggestions in a real chrome window: pillar C's third surface.
 *
 * The ordering itself is covered in node (`tests/node/test_suggest.mjs`) and
 * the two new reads in xpcshell, so neither is repeated here. What is here is
 * everything those cannot see: that the bar actually asks, that a read landing
 * after the keystroke that asked for it does not move the row under the user's
 * selection, and that accepting a page goes to it — by re-entering the trail
 * node when there is one, which is the difference between this and an address
 * bar with a nicer sort.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSTrailSession, nodeKey } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { R_PAGE, T_CONTEXT, T_CROSSING, T_HISTORY, T_MARK, TIER_LABELS } =
  ChromeUtils.importESModule("resource:///modules/FOSSuggest.sys.mjs");
const { PlacesTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/PlacesTestUtils.sys.mjs"
);

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.org/";

function bar() {
  return FOSCommandBar.forWindow(window);
}

function engine() {
  return FOSContextEngine.forWindow(window);
}

function session() {
  return FOSTrailSession.forWindow(window);
}

/**
 * Type into the bar and let it re-render, as a keystroke would.
 *
 * @param {string} text The whole line to put in the input.
 */
function type(text) {
  const input = bar().input;
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function pageRows() {
  return [
    ...window.document.querySelectorAll(
      '.fos-commandbar-row[data-kind="page"]'
    ),
  ];
}

function selectedRow() {
  return window.document.querySelector(
    '.fos-commandbar-row[aria-selected="true"]'
  );
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
 * Put the bar back on the engine's own suggestions.
 *
 * Every file in this directory shares one window, so a test that swaps the
 * source has to put it back or every later file is driving a stub.
 */
function restoreSuggestions() {
  bar().setSuggestions({
    suggest: query => engine().suggest(query),
    activate: row => engine().activate(row),
  });
}

registerCleanupFunction(() => {
  bar().close();
  bar().dismissNotice();
  restoreSuggestions();
});

add_task(async function test_the_empty_bar_still_teaches() {
  // The empty state is the twelve verbs and nothing else. It is the only
  // surface that can teach the vocabulary, and a list of pages there would be
  // ranked by recency — the signal this project rejected for deciding what
  // belongs together.
  bar().open();
  type("");
  await new Promise(resolve => window.setTimeout(resolve, 0));
  Assert.equal(pageRows().length, 0, "no pages offered for an empty line");
  Assert.greaterOrEqual(
    window.document.querySelectorAll('.fos-commandbar-row[data-kind="action"]')
      .length,
    12,
    "the action table is what an empty bar shows"
  );
  bar().close();
});

add_task(async function test_a_query_is_answered_from_the_store() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  await engine().settled;

  bar().open();
  type("example");
  await TestUtils.waitForCondition(
    () => pageRows().length,
    "the bar offered pages for the query"
  );

  const urls = pageRows().map(row => row.getAttribute("data-key"));
  Assert.ok(urls.includes(PAGE_A), "a page browsed this session is offered");

  // The heading is the tier, and the tier is the whole explanation for why the
  // row is where it is. A ranking nobody can read is the thing this replaces.
  const headings = [
    ...window.document.querySelectorAll(".fos-commandbar-group"),
  ].map(el => el.textContent);
  Assert.ok(
    headings.includes(TIER_LABELS[T_CONTEXT]),
    "and it says which tier put it there"
  );
  bar().close();
});

add_task(async function test_the_floor_offers_what_no_tier_above_it_knows() {
  // The reason candidates come from a database rather than from the window:
  // close to 60% of complex information-gathering tasks continue across
  // sessions, so the bar has to offer pages this window never loaded. A page
  // from a session long past is reached through the Places floor — which is
  // why the floor is always read and not a fallback for when the good tiers
  // come back empty.
  const url = "https://example.org/an-older-page";
  await PlacesTestUtils.addVisits([
    { uri: Services.io.newURI(url), title: "Something from an older session" },
  ]);

  const rows = await engine().suggest("older session");
  const row = rows.find(each => each.url === url);
  Assert.ok(row, "a page this window has never loaded is still offered");
  Assert.equal(
    row.tier,
    T_HISTORY,
    "from the floor, which is where it belongs"
  );
  Assert.equal(
    row.group,
    TIER_LABELS[T_HISTORY],
    "and it says so rather than claiming provenance it does not have"
  );

  await PlacesUtils.history.remove(url);
});

add_task(
  async function test_a_crossing_is_offered_with_the_trail_that_found_it() {
    // Tier 4, end to end, and the one tier no other browser could offer: another
    // line of enquiry reached a page this context reached, so what else that
    // line found is material worth putting up — and the row names the trail, so
    // the offer explains itself.
    await goTo(PAGE_A);
    await engine().settled;

    const store = await FOSContextEngine.store();
    const contextId = engine().activeContextId;
    const [mine] = await store.connection.execute(
      `SELECT n.id FROM trail_node n JOIN context_member m ON m.trail_node_id = n.id
     WHERE m.context_id = :id AND n.url = :url ORDER BY n.id DESC LIMIT 1`,
      { id: contextId, url: PAGE_A }
    );
    Assert.ok(mine, "the page the user is on is in the context");

    const theirs = await store.addTrail({ name: "a parallel enquiry" });
    await store.addNode({ trailId: theirs, url: PAGE_A });
    await store.addNode({
      trailId: theirs,
      url: "https://example.org/found-by-the-other-trail",
      title: "Reached from a parallel enquiry",
    });

    const rows = await engine().suggest("parallel enquiry");
    const row = rows.find(
      each => each.url === "https://example.org/found-by-the-other-trail"
    );
    Assert.ok(row, "what the other trail found is offered");
    Assert.equal(row.tier, T_CROSSING, "as a crossing");
    Assert.ok(
      row.detail.includes("a parallel enquiry"),
      "named with the trail that reached it, which is the whole explanation"
    );
  }
);

add_task(async function test_a_mark_typed_alone_addresses_its_page() {
  await goTo(PAGE_A);
  await engine().settled;

  const nodeId = session().currentNodeId;
  const letter = session().marks.markOf(nodeKey(nodeId));
  Assert.ok(letter, "the page the user is on has a mark");

  const rows = await engine().suggest(letter);
  Assert.equal(rows[0].tier, T_MARK, "the mark outranks every guess");
  Assert.equal(rows[0].url, PAGE_A, "and it names the page it addresses");
  Assert.equal(rows[0].kind, R_PAGE, "offered as a page like any other");

  // The spoken form of the same letter resolves through the same path, which
  // is what "no separate accessibility mode" means at this surface.
  const spoken = await engine().suggest(rows[0].spoken);
  Assert.equal(spoken[0]?.url, PAGE_A, "saying the word reaches the same page");
});

add_task(async function test_accepting_a_live_page_re_enters_it() {
  await goTo(PAGE_A);
  await goTo(PAGE_B);
  await engine().settled;

  const rows = await engine().suggest("example.com");
  const row = rows.find(each => each.url === PAGE_A);
  Assert.ok(row, "the page is on offer");

  // Not `browserLoaded`, and the assertion above says why: the page is
  // re-entered rather than reloaded, and a node still in this tab's chain is
  // reached by traversing to it — which fires no load event when the page
  // comes back out of the bfcache.
  const landed = BrowserTestUtils.waitForLocationChange(gBrowser, PAGE_A);
  const entered = engine().activate(row);
  Assert.ok(entered, "a page still on a trail is re-entered, not reloaded");
  await landed;
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE_A,
    "and the browser is on it"
  );
});

add_task(async function test_a_page_with_no_live_node_is_loaded_instead() {
  // A row from an older trail this session did not restore, or a Places row
  // that was never on a trail at all. It has to go somewhere rather than
  // silently doing nothing — and it must not be put back through query
  // resolution, which would write a URL into the query log as though it had
  // been searched for.
  const actions = bar().actions;
  const opened = [];
  const realOpenURL = actions.openURL.bind(actions);
  const realOpenQuery = actions.openQuery.bind(actions);
  actions.openURL = url => opened.push(url);
  actions.openQuery = () => Assert.ok(false, "a picked page is not a query");

  try {
    const entered = engine().activate({
      url: "https://example.org/never-restored",
      nodeId: 99999999,
      mark: null,
    });
    Assert.ok(!entered, "nothing was re-entered");
    Assert.deepEqual(
      opened,
      ["https://example.org/never-restored"],
      "the page was opened as the URL it already is"
    );
  } finally {
    actions.openURL = realOpenURL;
    actions.openQuery = realOpenQuery;
  }
});

add_task(async function test_a_late_read_does_not_move_the_selection() {
  // The hazard this guards: rows arrive after the keystroke that asked for
  // them, and the user has already arrowed down. If the list renumbers under
  // them, Enter opens a page they never looked at.
  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });
  bar().setSuggestions({
    suggest: () => pending,
    activate: () => {},
  });

  try {
    bar().open();
    // A prefix of an action word, not the word itself: `field` parses as a
    // complete command and a command is never a query, so it would be offered
    // no pages at all. `fie` is prose that happens to prefix one.
    type("fie");
    // The action-word completion, which is showing before any read lands.
    EventUtils.synthesizeKey("KEY_ArrowDown", {}, window);
    const anchored = selectedRow();
    Assert.ok(anchored, "a row is selected");
    const anchorId = anchored.id;

    release([
      {
        kind: R_PAGE,
        tier: T_CONTEXT,
        id: "page-context-0",
        key: PAGE_A,
        label: "A page that arrived late",
        detail: "",
        group: TIER_LABELS[T_CONTEXT],
        url: PAGE_A,
        nodeId: null,
        mark: null,
        spoken: null,
      },
    ]);
    await TestUtils.waitForCondition(
      () => pageRows().length,
      "the late rows landed"
    );

    Assert.equal(
      selectedRow()?.id,
      anchorId,
      "the selection is still on the row the user chose"
    );
  } finally {
    bar().close();
    restoreSuggestions();
  }
});

add_task(async function test_a_command_line_offers_no_pages() {
  // A line that has become a command is asking for a mark, not for a page.
  // Leaving the previous keystroke's pages under it would offer them as
  // answers to a question that is no longer being asked.
  bar().open();
  type("example");
  await TestUtils.waitForCondition(
    () => pageRows().length,
    "pages are showing to begin with"
  );

  type("enter ");
  Assert.equal(
    pageRows().length,
    0,
    "and they are gone the moment they stop applying"
  );
  bar().close();
});

add_task(async function test_enter_on_an_untouched_line_still_searches() {
  // The rule the whole grammar rests on: showing more must never change what
  // Enter does. A page offered below the line is offered, not triggered.
  bar().open();
  type("example");
  await TestUtils.waitForCondition(
    () => pageRows().length,
    "pages are on offer"
  );

  const actions = bar().actions;
  const realOpenQuery = actions.openQuery.bind(actions);
  // Stubbed because running it for real would put a search engine's URL into
  // the test harness, which refuses to leave the machine — and what is under
  // test is which of the two things Enter chose, not the load itself.
  actions.openQuery = () => null;
  try {
    const result = bar().run();
    Assert.equal(result.type, "query", "the line ran as the query it is");
  } finally {
    actions.openQuery = realOpenQuery;
  }
});
