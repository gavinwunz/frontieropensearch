/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The pictures the README points at, made by the browser they are of.
 *
 * Not a test — nothing here asserts a property of the product, and the file is
 * skipped outright unless `FOS_SHOTS` names a directory, so it costs an
 * ordinary suite run one skipped task. `agent/smoke.sh` is what sets it.
 *
 * It is a test file rather than a script because of what happened to the last
 * set: they were taken by a scratch file that was deleted afterwards, so the
 * README ended up pointing at pictures nobody could make again, several of
 * which showed a tab strip the browser no longer has. A screenshot that cannot
 * be regenerated is out of date the moment the surface moves and there is no
 * way to tell.
 *
 * The session it drives is deliberately the one the project is about: a search
 * that branches three ways across three pages that are actually worth reading,
 * so the cards in the Field are recognisable and the ranking has something
 * real to rank.
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
const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSContextSidebar } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextSidebar.sys.mjs"
);
const { FOSTrailRail } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailRail.sys.mjs"
);
const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs"
);

SearchTestUtils.init(this);

const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";
const MEMEX = `${FIXTURES}memex.html`;
const XANADU = `${FIXTURES}xanadu.html`;
const NLS = `${FIXTURES}nls.html`;

/** Long enough for the Field's settle capture, which fires a second in. */
const SETTLED_MS = 1400;

let win = null;
let shots = null;

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

function rail() {
  return FOSTrailRail.forWindow(win);
}

function frame() {
  return new Promise(resolve => win.requestAnimationFrame(resolve));
}

/**
 * Navigate, then wait out the settle so the page gets its thumbnail.
 *
 * @param {string} url Where to go.
 */
async function read(url) {
  const browser = win.gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, url);
  await BrowserTestUtils.browserLoaded(browser, false, url);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
}

/**
 * Photograph the whole chrome window.
 *
 * The remotecontrol attribute comes off for the length of the capture and goes
 * straight back: the robot icon and red stripes it draws are upstream's
 * warning that a browser is being driven, which is right, and which documents
 * the harness rather than this browser.
 *
 * @param {string} name The file name, without an extension.
 */
async function shoot(name) {
  await frame();
  await frame();

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
  // default path draws the parent process's own layers, and content lives in
  // another process, so every screenshot this project has taken so far has a
  // blank white rectangle where the page was. Widget layers snapshot what the
  // compositor actually put on the screen, which is the thing being
  // documented.
  const flags =
    ctx.DRAWWINDOW_DRAW_VIEW |
    ctx.DRAWWINDOW_USE_WIDGET_LAYERS |
    ctx.DRAWWINDOW_DRAW_CARET;
  ctx.drawWindow(win, 0, 0, width, height, "white", flags);

  if (controlled) {
    root.setAttribute("remotecontrol", "true");
  }

  const data = canvas
    .toDataURL("image/png")
    .replace(/^data:image\/png;base64,/, "");
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const path = PathUtils.join(shots, `${name}.png`);
  await IOUtils.write(path, bytes);
  info(`SHOT ${path} (${bytes.length} bytes)`);
}

add_setup(async function () {
  shots = Services.env.get("FOS_SHOTS");
  if (!shots) {
    return;
  }
  requestLongerTimeout(6);
  await SearchTestUtils.installSearchExtension(
    {
      name: "DemoSearch",
      search_url: MEMEX,
    },
    { setAsDefault: true }
  );
  win = await BrowserTestUtils.openNewBrowserWindow();
  registerCleanupFunction(async () => {
    await BrowserTestUtils.closeWindow(win);
    win = null;
  });
});

add_task(async function take_the_screenshots() {
  if (!shots) {
    // The harness fails a file that records nothing at all, so the skip says
    // so out loud rather than passing silently.
    Assert.ok(true, "FOS_SHOTS is not set; nothing to photograph");
    return;
  }

  // A session with a shape: one enquiry that branches three ways, and a second
  // enquiry beside it so the Field has more than one region to show.
  bar().run("associative trails memex");
  await BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
  await engine().settled;

  const rootId = session().currentNodeId;
  for (const url of [XANADU, NLS]) {
    await session().enter(rootId);
    await read(url);
  }
  await engine().settled;
  bar().run("name memex research");
  await engine().settled;

  await BrowserTestUtils.openNewForegroundTab(win.gBrowser, XANADU);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
  bar().run("name hypertext history");
  await engine().settled;

  // The window opened on a start page of its own and that page is a card like
  // any other. It belongs to the harness rather than to the session being
  // photographed, so it goes before the Field is shown — a blank grey card
  // labelled example.com in the middle of the README would be documenting the
  // test rig.
  for (const card of field().model.cards()) {
    const node = session().store.getNode(card.node_id);
    if (!node || !node.url.startsWith(FIXTURES)) {
      field().dismissCard(card.id);
    }
  }

  // 1. The trail rail: the branch a linear history would have destroyed.
  //    Opened through its own command rather than a verb — the rail is a view,
  //    and `GRAMMAR.md` gives verbs to actions.
  await session().enter(rootId);
  await BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
  rail().open();
  await shoot("shot-trails");
  rail().close();

  // 2. The Field, zoomed out: every open page at once, two enquiries apart.
  field().open();
  field().showOverview();
  await shoot("shot-field-overview");

  // 3. The Field, zoomed into one enquiry.
  const region = field()
    .model.regions()
    .find(r => r.id === session().activeTrailId);
  if (region) {
    field().showRegion(region.id);
    await shoot("shot-field-region");
  }
  field().close();

  // 4. The command bar ranking by the enquiry in play rather than by how often
  //    a page has been visited. The query matches a page on both trails, which
  //    is what makes the tier headings worth photographing: the same word
  //    reaches this context, another trail, and history, and the bar says
  //    which is which.
  bar().open();
  bar().input.value = "xanadu";
  bar().input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await TestUtils.waitForCondition(
    () =>
      win.document.querySelectorAll('.fos-commandbar-row[data-kind="page"]')
        .length,
    "the bar offered pages before it was photographed"
  );
  await shoot("shot-command-bar");
  bar().close();

  // 5. What the context knows so far.
  //
  //    One more question first, asked from the page in front of us and then
  //    returned to. That is the ordinary shape of coming back to a hub page,
  //    and it is what fills the sidebar's page-scoped section — the flow above
  //    never revisits a page it searched from, so without this the picture
  //    would document a panel with one of its sections permanently missing.
  const askedFrom = session().currentNodeId;
  bar().run("xanadu transclusion");
  await BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
  await engine().settled;
  await session().enter(askedFrom);
  await BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await new Promise(resolve => win.setTimeout(resolve, SETTLED_MS));
  await engine().settled;

  bar().run("what");
  await shoot("shot-context");
  // Put the window back to rest. `dismiss` was used here and is a Field verb
  // that takes a required target, so it parsed as an error and closed nothing:
  // the next picture was taken with this sidebar still open over the toolbar
  // and `what`'s sentence still on screen, which is not "an ordinary window
  // doing nothing" and could not answer the question that shot is taken for.
  FOSContextSidebar.forWindow(win).close();
  bar().dismissNotice();

  // 6. The ambient signal, which is the one thing the fork says about a page
  //    that loads where you are not looking. It is a state on the resting bar
  //    rather than a notification, so the picture is of an ordinary window
  //    doing nothing — which is the point, and is also the only way to see
  //    whether the mark reads at a glance without shouting.
  field().open();
  field().close();
  const background = BrowserTestUtils.addTab(win.gBrowser, NLS);
  await BrowserTestUtils.browserLoaded(background.linkedBrowser, false, NLS);
  await TestUtils.waitForCondition(
    () => win.gURLBar.hasAttribute("fos-unseen"),
    "the bar took the mark before it was photographed"
  );
  await shoot("shot-unseen");

  // 7. And the other half of that signal: pressing the key the dot is asking
  //    for, and finding the Field able to say which card it meant. The tab is
  //    still open, because the arrival has to still be there to be marked.
  //    Taken at the overview, which is the level the accent is hardest at — a
  //    miniature is about ten pixels across here.
  field().open();
  await shoot("shot-arrived");
  field().close();

  BrowserTestUtils.removeTab(background);
  field().open();
  field().close();

  Assert.ok(true, "screenshots taken");
});
