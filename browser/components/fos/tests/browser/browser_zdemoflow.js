/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Phase 2's acceptance criterion, driven as one sequence.
 *
 * The phase plan's "done when" is a single demo flow: search, branch three
 * ways, zoom out to the Field, switch context, export a context pack. Every
 * one of those five is already covered somewhere in this directory, and that
 * is precisely why this file exists: the other six files each prove one pillar
 * in isolation, from state they set up themselves, and none of them can see
 * whether the five compose. A user does not perform a property — they perform a
 * sequence, and a sequence is where the seams between three pillars show.
 *
 * So this is deliberately ONE task rather than five. Splitting it would let
 * each stage re-establish its own preconditions, which is the exact thing the
 * other files already do and the exact thing that makes them blind to this. If
 * stage four only works because stage three was skipped, this file has to fail.
 *
 * It runs in **its own chrome window**, and that is load-bearing rather than
 * tidiness. Every other file here shares one window, so by the time this one
 * starts, six files' worth of trails and cards have already spent the 26
 * marks — and a demo whose fourth stage needs a letter for a named context
 * would fail for a reason that has nothing to do with whether the five stages
 * compose. Each pillar is instantiated per window (`forWindow`), so a fresh
 * window is a fresh session with its own marks, Field, trail session and
 * engine, over the one shared profile database — which is exactly what a demo
 * is. It still sorts last, so that its own window and the extra rows it writes
 * land after everything that reads the shared one.
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
const { FOSContextEngine, contextKey } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { LEVEL } = ChromeUtils.importESModule(
  "resource:///modules/FOSFieldView.sys.mjs"
);
const { T_CONTEXT } = ChromeUtils.importESModule(
  "resource:///modules/FOSSuggest.sys.mjs"
);
const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs"
);

SearchTestUtils.init(this);

/**
 * The enquiry the flow is about.
 *
 * Prose with spaces, so the command bar resolves it as a search rather than a
 * URL — the demo's first step has to go down the search path, not the fixup
 * path, or the query is never recorded as a query at all.
 */
const QUERY = "associative trails memex";

/** Where the test engine lands. Local, so the flow never leaves the machine. */
const RESULT = "https://example.com/?q=associative+trails+memex";

/**
 * The three branches off the search result.
 *
 * Three distinct hosts rather than three paths on one: a context's pages are
 * grouped by host in the exported pack, so same-host branches would collapse
 * into one heading and the export would not show that the branching happened.
 */
const BRANCH_ONE = "https://example.org/";
const BRANCH_TWO = "https://example.net/";
const BRANCH_THREE = "https://test1.example.com/";

/** The interruption: a second enquiry, on its own trail and its own context. */
const OTHER = "https://example.com/";

const TRAIL_NAME = "memex research";

/** The flow's own window, opened by the setup task. */
let win = null;

function session() {
  return FOSTrailSession.forWindow(win);
}

function field() {
  return FOSFieldSurface.forWindow(win);
}

function bar() {
  return FOSCommandBar.forWindow(win);
}

function engine() {
  return FOSContextEngine.forWindow(win);
}

/**
 * Navigate the flow's tab and wait for the load to commit.
 *
 * @param {string} url Where to go.
 */
async function goTo(url) {
  const browser = win.gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, url);
  await BrowserTestUtils.browserLoaded(browser, false, url);
}

/**
 * Let the recorder's queue drain and hand back the store.
 *
 * Recording is deliberately off the navigation path, so a stage that asserts
 * immediately after a load is asserting on a race.
 *
 * @returns {Promise<object>} The store.
 */
async function settled() {
  await engine().settled;
  return FOSContextEngine.store();
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

/**
 * Photograph the whole chrome window, if this run was asked for pictures.
 *
 * Off unless `FOS_SHOTS` names a directory, so an ordinary test run writes
 * nothing and only the smoke run (`agent/smoke.sh`) produces artefacts. The
 * directory is passed in rather than derived, because a test cannot know where
 * the source tree is and a path baked into the tree would be a personal path
 * in a public repository.
 *
 * `drawWindow` is the only route to a picture of chrome here: there is no
 * headless display on this machine, and a real X grab would photograph
 * somebody's desktop rather than the browser.
 *
 * @param {string} name The file name, without an extension.
 */
async function shoot(name) {
  const dir = Services.env.get("FOS_SHOTS");
  if (!dir) {
    return;
  }
  // A frame to let whatever the stage just did actually paint.
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  await new Promise(resolve => win.requestAnimationFrame(resolve));

  // The harness drives this window over Marionette, and a remote-controlled
  // window wears a robot icon and red diagonal stripes across the address bar
  // (`:root[remotecontrol]`, browser/themes/shared/urlbar-searchbar.css). That
  // warning is upstream's and it is correct — it exists to tell a user their
  // browser is being driven — but it is a fact about the harness rather than
  // about this browser, and a screenshot carrying it documents the test rig.
  // Dropped for the length of the capture and put straight back, so the window
  // the rest of the flow runs in keeps the warning it is entitled to.
  const root = win.document.documentElement;
  const controlled = root.hasAttribute("remotecontrol");
  if (controlled) {
    root.removeAttribute("remotecontrol");
  }

  const ratio = win.devicePixelRatio;
  const width = win.innerWidth;
  const height = win.innerHeight;
  const canvas = win.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas"
  );
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  // `DRAWWINDOW_USE_WIDGET_LAYERS` is what puts the page in the picture. The
  // default path draws the parent process's own layers and content lives in
  // another process, so without it every stage is photographed with a blank
  // white rectangle where the page was.
  const flags =
    ctx.DRAWWINDOW_DRAW_VIEW |
    ctx.DRAWWINDOW_USE_WIDGET_LAYERS |
    ctx.DRAWWINDOW_DRAW_CARET;
  ctx.drawWindow(win, 0, 0, width, height, "white", flags);

  const data = canvas
    .toDataURL("image/png")
    .replace(/^data:image\/png;base64,/, "");
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  if (controlled) {
    root.setAttribute("remotecontrol", "true");
  }

  const path = PathUtils.join(dir, `${name}.png`);
  await IOUtils.write(path, bytes);
  info(`SHOT ${path} (${bytes.length} bytes)`);
}

/**
 * Write a text artefact beside the screenshots, if pictures were asked for.
 *
 * @param {string} name The file name, with its extension.
 * @param {string} text What to write.
 */
async function writeArtefact(name, text) {
  const dir = Services.env.get("FOS_SHOTS");
  if (!dir) {
    return;
  }
  const path = PathUtils.join(dir, name);
  await IOUtils.writeUTF8(path, text);
  info(`ARTEFACT ${path} (${text.length} characters)`);
}

/**
 * The children of a node, oldest first.
 *
 * @param {number} nodeId The parent.
 * @returns {object[]} Its children.
 */
function childrenOf(nodeId) {
  return session()
    .store.nodes(session().activeTrailId)
    .filter(node => node.parent_id === nodeId)
    .sort((a, b) => a.id - b.id);
}

add_setup(async function () {
  // The flow is five stages with real navigation in three of them, in a window
  // that has to be opened and closed around them.
  requestLongerTimeout(3);

  // A real engine that resolves locally. Typing prose and pressing Enter is
  // the first step of the demo, and it has to go through the search path the
  // user's default engine would — a URL typed instead would prove the fixup
  // path and skip the one this stage is about. `example.com` is the mochitest
  // server, so the flow still never touches the network.
  await SearchTestUtils.installSearchExtension(
    {
      name: "DemoSearch",
      search_url: "https://example.com/",
      search_url_get_params: "q={searchTerms}",
    },
    { setAsDefault: true }
  );

  win = await BrowserTestUtils.openNewBrowserWindow();
  registerCleanupFunction(async () => {
    await BrowserTestUtils.closeWindow(win);
    win = null;
  });
});

add_task(async function test_the_demo_flow() {
  // ---------------------------------------------------------------- 1. search
  info("stage 1 — search");

  bar().open();
  Assert.equal(
    win.document.activeElement,
    bar().input,
    "the one entry surface took focus, so the query can just be typed"
  );

  type(QUERY);
  const searchLoaded = BrowserTestUtils.browserLoaded(
    win.gBrowser.selectedBrowser,
    false,
    url => url.startsWith("https://example.com/?q=")
  );
  EventUtils.synthesizeKey("KEY_Enter", {}, win);
  await searchLoaded;
  const store = await settled();

  Assert.ok(!bar().isOpen, "the bar closed behind the query");

  const searchNodeId = session().currentNodeId;
  const searchNode = session().store.getNode(searchNodeId);
  Assert.ok(searchNode, "the search result is a node on the trail");
  Assert.equal(
    searchNode.url,
    RESULT,
    "and the node is the page the engine resolved to"
  );

  const trailId = session().activeTrailId;
  // Joined to `trail_node` rather than compared against `searchNodeId`: the
  // session's node ids and the database's are separate spaces, mapped inside
  // the engine, and they only ever coincide by accident. Asserting on the URL
  // is asserting on the thing that was actually claimed.
  const [queryRow] = await store.connection.execute(
    `SELECT q.normalised_intent, n.url AS node_url
     FROM query q LEFT JOIN trail_node n ON n.id = q.trail_node_id
     WHERE q.raw = :raw ORDER BY q.id DESC LIMIT 1`,
    { raw: QUERY }
  );
  Assert.ok(queryRow, "the query itself was recorded, not just the page");
  Assert.equal(
    queryRow.getResultByName("node_url"),
    RESULT,
    "and it is attached to the page it opened, which is what ties C to B"
  );

  const contextId = engine().activeContextId;
  Assert.notStrictEqual(contextId, null, "the search opened a context");

  await shoot("demo-1-search");

  // ------------------------------------------------- 2. branch three ways
  info("stage 2 — branch three ways");

  // Each branch is: go somewhere from the search result, then re-enter the
  // search result and go somewhere else. In a linear-history browser the
  // second of those destroys the first. Doing it three times is the demo's
  // claim stated at the only scale where it is interesting — two branches
  // could be a back button with one forward entry; three cannot.
  for (const url of [BRANCH_ONE, BRANCH_TWO, BRANCH_THREE]) {
    // Waited onto the page, not merely asked for. `enter` resolves once it has
    // asked, and for a node still in this tab's chain the load it asks for is
    // a traversal — so starting the branch navigation immediately after would
    // race a load that is still on its way.
    const back = BrowserTestUtils.waitForLocationChange(
      win.gBrowser,
      session().store.getNode(searchNodeId).url
    );
    await session().enter(searchNodeId);
    await back;
    Assert.equal(
      session().currentNodeId,
      searchNodeId,
      `re-entered the search result before branching to ${url}`
    );
    await goTo(url);
  }
  await settled();

  const branches = childrenOf(searchNodeId);
  Assert.deepEqual(
    branches.map(node => node.url),
    [BRANCH_ONE, BRANCH_TWO, BRANCH_THREE],
    "all three branches hang off the search result as siblings, and the " +
      "first two were not destroyed by the ones that came after"
  );
  Assert.equal(
    new Set(branches.map(node => node.id)).size,
    3,
    "three distinct nodes: re-entry replayed a page rather than making a node"
  );
  Assert.equal(
    session().store.nodes(trailId).length,
    4,
    "the trail is exactly the search result and its three branches"
  );

  await shoot("demo-2-branches");

  // ------------------------------------------------ 3. zoom out to the Field
  info("stage 3 — zoom out to the Field");

  // Pressed with the page focused, which is the only state a user is ever in
  // when they reach for it — and the reason this is awaited rather than
  // asserted outright: a key struck while content holds focus goes to the
  // content process first and reaches the chrome keyset only if that process
  // declines it. The round trip is real and asynchronous, so a synchronous
  // assertion here tests the IPC latency rather than the binding.
  EventUtils.synthesizeKey("KEY_F2", {}, win);
  await TestUtils.waitForCondition(
    () => field().isOpen,
    "one key left the page for the Field"
  );
  Assert.equal(field().level, LEVEL.OVERVIEW, "and it opens zoomed out");

  const tile = win.document.querySelector(
    `.fos-field-tile[data-region-id="${trailId}"]`
  );
  Assert.ok(tile, "the enquiry has a region of its own in the overview");

  await shoot("demo-3-field-overview");

  field().showRegion(trailId);
  Assert.equal(field().level, LEVEL.REGION, "zoomed into the enquiry");

  const model = field().model;
  const onScreen = new Set(field().renderedCardIds);
  for (const node of [searchNode, ...branches]) {
    const card = model.cardForNode(node.id);
    Assert.ok(card, `${node.url} has a card`);
    Assert.ok(
      onScreen.has(card.id),
      `and ${node.url} is on screen, so the whole enquiry is visible at once`
    );
  }

  // Every card carries a picture, and the branch point most of all.
  //
  // This is the one place in the suite where the condition arises, which is
  // why the assertion is here rather than beside the Field's other thumbnail
  // tests: branching re-enters the page being branched from, `enter` returns
  // before the restore commits, and the navigation that follows is therefore
  // still suppressed by the restore flag. So the branch point is never
  // departed at all, and its delayed settle capture was discarded as stale the
  // moment the first branch was taken. It used to render as a grey rectangle
  // ringed by three branches that all had pictures — dead centre of the
  // Field's own screenshot, and the one card the eye goes to.
  //
  // `data:` and not `moz-page-thumb:`: the disk store's copy would satisfy a
  // laxer check without the node ever having been photographed.
  for (const node of [searchNode, ...branches]) {
    const card = model.cardForNode(node.id);
    const shot = win.document.querySelector(
      `.fos-field-card[data-card-id="${card.id}"] .fos-field-shot`
    );
    Assert.ok(
      shot?.style.backgroundImage.startsWith('url("data:'),
      `${node.url} is a card with a picture on it, not a list row`
    );
  }

  await shoot("demo-3-field-region");

  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  Assert.ok(!field().isOpen, "and back to the page");

  // ------------------------------------------------------- 4. switch context
  info("stage 4 — switch context");

  // A context earns a letter by being named: an unnamed context is the trail
  // you are already on, and there is nothing to switch to.
  bar().run(`name ${TRAIL_NAME}`);
  await settled();
  Assert.equal(
    session().store.getTrail(trailId)?.name,
    TRAIL_NAME,
    "the enquiry has a name"
  );

  const mark = bar().marks.markOf(contextKey(contextId));
  Assert.ok(mark, "and its context is addressable");
  Assert.equal(bar().marks.typeAt(mark), "context", "as a context");

  // The interruption: a second enquiry, in its own tab and so on its own
  // trail. Named too, because the demo switches away and back, and a context
  // is only addressable once it has a name.
  await BrowserTestUtils.openNewForegroundTab(win.gBrowser, OTHER);
  await settled();
  bar().run("name the interruption");
  await settled();

  const otherContextId = engine().activeContextId;
  Assert.notEqual(
    otherContextId,
    contextId,
    "the second enquiry is a context of its own"
  );
  const otherMark = bar().marks.markOf(contextKey(otherContextId));
  Assert.ok(otherMark, "and it is addressable too");

  // Both directions are driven with the verb rather than left to the second
  // tab to move the active context by itself. Provenance would do it here, but
  // it stops doing it the moment anyone uses this verb once — a pinned context
  // outranks provenance until it is released — so a demo that relied on the
  // tab would be demonstrating the one case a real session leaves behind
  // immediately. It is also the stronger claim: the demo says "switch
  // context", and this is the thing that switches it.
  bar().run(`context ${otherMark}`);
  await settled();
  Assert.equal(
    engine().activeContextId,
    otherContextId,
    "`context <mark>` moved the active context off the enquiry"
  );

  bar().run(`context ${mark}`);
  await settled();
  Assert.equal(
    engine().activeContextId,
    contextId,
    "and back to the enquiry, from a tab that was never on its trail"
  );

  // The switch is only worth having if the bar answers differently after it.
  // This is the claim pillar C is actually making: ranking by what you are
  // working on rather than by what you visit most.
  const suggestions = await engine().suggest("example");
  Assert.ok(
    suggestions.some(
      item => item.tier === T_CONTEXT && item.url === BRANCH_ONE
    ),
    "and a page of the enquiry is now offered because of the context it is " +
      "in, from a tab that never visited it"
  );

  await shoot("demo-4-switch-context");

  // ------------------------------------------------ 5. export a context pack
  info("stage 5 — export a context pack");

  // The store is asserted before the brief, and separately, because for
  // several runs the two were indistinguishable. A pack missing a page can
  // mean the engine never recorded it or the renderer dropped it, and reading
  // that off the markdown alone sent this project after the wrong one three
  // times. Asking the store first says which half is at fault in the failure
  // message itself.
  const contents = await (await settled()).contextContents(contextId);
  Assert.deepEqual(
    [...contents.pages.map(page => page.url)].sort(),
    [RESULT, BRANCH_ONE, BRANCH_TWO, BRANCH_THREE].sort(),
    "the store holds the enquiry's four pages, and exactly those"
  );

  await SimpleTest.promiseClipboardChange(
    text => text.includes("# Context pack"),
    () => bar().run("pack")
  );
  const pack = await navigator.clipboard.readText();

  Assert.ok(
    pack.includes(TRAIL_NAME),
    "the brief is the context that was switched to, by name"
  );
  Assert.ok(
    pack.includes(QUERY),
    "it carries the question that started the enquiry"
  );
  for (const url of [RESULT, BRANCH_ONE, BRANCH_TWO, BRANCH_THREE]) {
    Assert.ok(pack.includes(url), `and the page at ${url} that answered it`);
  }
  Assert.ok(
    pack.includes("Frontier OpenSearch"),
    "and says where it came from, since a model should not have to guess"
  );

  await shoot("demo-5-pack");
  // The brief itself, not only a picture of the surface that produced it: the
  // artefact this pillar exists to hand to a model is the markdown.
  await writeArtefact("demo-pack.md", pack);

  // And the release, which is what stops the switch in stage four outliving
  // the enquiry that motivated it. Without it one deliberate `context` pins
  // the bar's ranking, `what` and `pack` to that enquiry for the rest of the
  // session, however many tabs on other topics come after.
  bar().run("context");
  await settled();
  Assert.equal(
    engine().activeContextId,
    otherContextId,
    "bare `context` hands the decision back and follows the tab we are on"
  );
});
