/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * A private window records to memory and never to the profile's database.
 *
 * This is the only file in the directory that can see the property at all.
 * Every check in the store's own tests passed while private browsing was
 * writing every URL, every search and every dwell time to a file on the disk,
 * because the store cannot tell which window a row came from and the defect was
 * entirely in which store a window was handed. So the assertions here are all
 * of the same shape: browse in a real private window, then look in the *other*
 * database and find nothing.
 *
 * The second half is lifetime rather than storage, and is the failure the
 * private-browsing literature keeps finding in shipped browsers: state that
 * survives from one private session into the next. The store is dropped at
 * `last-pb-context-exited`, so the check is that a second private session
 * cannot see the first one's browsing.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { DATABASE_FILENAME, FOSContextStore } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextStore.sys.mjs"
);
const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { FORGOTTEN_TOPIC } = ChromeUtils.importESModule(
  "resource:///modules/FOSForget.sys.mjs"
);

/**
 * A host nothing else in this directory browses, so a row bearing it on the
 * disk can only have come from the private window below.
 */
const SECRET = "https://example.com/private-only-";

/**
 * Open a private window with its Context Engine attached and recording.
 *
 * Not `BrowserTestUtils.openNewBrowserWindow({private: true})`, which waits for
 * the window's first tab to load and never returns here: the content process
 * for a private window's initial page dies on this configuration, which is the
 * same x11 failure the tab-test manifest already skips files for and is not
 * anything this fork does. Opening the window directly and waiting for its
 * delayed startup gets to the same place without loading that page.
 *
 * The observer is registered before the window exists because delayed startup
 * can finish before a caller that opened the window first gets to subscribe.
 *
 * `attach` is started by window init and deliberately not awaited there, so a
 * test that navigated immediately would be racing the store opening.
 *
 * @param {object} [options]
 * @param {boolean} [options.explicit] Ask for a private window outright. False
 *   asks for an ordinary one, which is what permanent private browsing turns
 *   into a private one.
 * @returns {Promise<object>} The window.
 */
async function openPrivateWindow({ explicit = true } = {}) {
  let started;
  const startedUp = new Promise(resolve => {
    started = resolve;
  });
  const observer = {
    observe(subject) {
      started(subject);
    },
  };
  Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  let win;
  try {
    // Under `browser.privatebrowsing.autostart` the caller asks for an
    // *ordinary* window and gets a private one; that is the whole point of the
    // mode, and asking for a private one explicitly would not test it.
    win = explicit
      ? window.OpenBrowserWindow({ private: true })
      : window.OpenBrowserWindow();
    await startedUp;
  } finally {
    Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
  }
  const engine = FOSContextEngine.forWindow(win);
  await TestUtils.waitForCondition(
    () => engine.store,
    "the private window's engine finished attaching"
  );
  return win;
}

/**
 * Navigate a window's selected tab and let the recorder catch up.
 *
 * @param {object} win
 * @param {string} url
 */
async function browse(win, url) {
  const browser = win.gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, url);
  await BrowserTestUtils.browserLoaded(browser, false, url);
  await FOSContextEngine.forWindow(win).settled;
}

/**
 * How many nodes in a store carry a URL prefix.
 *
 * @param {object} store
 * @param {string} prefix
 * @returns {Promise<number>}
 */
async function nodesUnder(store, prefix) {
  const [row] = await store.connection.execute(
    `SELECT COUNT(*) AS n FROM trail_node WHERE url LIKE :pattern`,
    { pattern: `${prefix}%` }
  );
  return row.getResultByName("n");
}

/**
 * Close a private window and wait for the private session to actually end.
 *
 * Waiting on the store rather than on `last-pb-context-exited` is deliberate.
 * The topic is the trigger and not the event: it can arrive while another
 * private window is already open, in which case nothing is dropped and rightly
 * so. What every task below is really waiting for is the private session's
 * record ceasing to exist, and that is what this waits for.
 *
 * @param {object} win
 */
async function endPrivateSession(win) {
  await BrowserTestUtils.closeWindow(win);
  await TestUtils.waitForCondition(
    () => !FOSContextEngine.privateStoreIsOpen,
    "the private session's store was dropped"
  );
}

add_task(async function test_a_private_window_writes_nothing_to_the_profile() {
  const disk = await FOSContextEngine.store();
  const before = await nodesUnder(disk, SECRET);

  const win = await openPrivateWindow();
  const engine = FOSContextEngine.forWindow(win);
  await browse(win, `${SECRET}one`);
  await browse(win, `${SECRET}two`);

  Assert.notEqual(
    engine.store,
    disk,
    "the private window's engine is not holding the profile's store"
  );
  Assert.equal(
    await nodesUnder(disk, SECRET),
    before,
    "browsing in a private window wrote nothing to the profile's database"
  );

  // The other half of the claim, and the reason this is not simply a matter of
  // switching recording off: the private window records exactly as a normal one
  // does, so its rail, its Field and its sidebar have something to draw.
  Assert.equal(
    await nodesUnder(engine.store, SECRET),
    2,
    "and recorded both pages into the private session's own store"
  );
  Assert.ok(
    FOSTrailSession.forWindow(win).store.trails().length,
    "so the private window has a trail behind it like any other"
  );

  await endPrivateSession(win);
});

add_task(async function test_a_private_session_cannot_see_the_last_one() {
  const first = await openPrivateWindow();
  const firstStore = FOSContextEngine.forWindow(first).store;
  await browse(first, `${SECRET}first-session`);
  Assert.equal(
    await nodesUnder(firstStore, SECRET),
    1,
    "the first private session recorded its page"
  );
  await endPrivateSession(first);

  const second = await openPrivateWindow();
  const secondStore = FOSContextEngine.forWindow(second).store;
  Assert.notEqual(
    secondStore,
    firstStore,
    "the second private session got a store of its own"
  );
  Assert.equal(
    await nodesUnder(secondStore, SECRET),
    0,
    "and starts empty, so it cannot see what the last one browsed"
  );
  await endPrivateSession(second);
});

add_task(async function test_two_private_windows_share_one_session() {
  const first = await openPrivateWindow();
  await browse(first, `${SECRET}shared`);
  const second = await openPrivateWindow();

  Assert.equal(
    FOSContextEngine.forWindow(second).store,
    FOSContextEngine.forWindow(first).store,
    "a second private window joins the session already open"
  );

  // Closing one private window is not the end of the private session, so the
  // store must survive it — this is the difference between the topic observed
  // and a plain unload, and getting it wrong would empty the rail of a window
  // still on screen.
  await BrowserTestUtils.closeWindow(first);
  Assert.equal(
    await nodesUnder(FOSContextEngine.forWindow(second).store, SECRET),
    1,
    "and the session survives the other window closing"
  );
  await endPrivateSession(second);
});

add_task(async function test_clearing_history_leaves_a_private_window_alone() {
  const win = await openPrivateWindow();
  await browse(win, `${SECRET}kept`);
  const engine = FOSContextEngine.forWindow(win);
  const tree = FOSTrailSession.forWindow(win).store;
  const nodesBefore = tree.nodes().length;

  // Ids in the two databases start at 1 and collide by construction, so a
  // private window acting on the disk store's forget summary would drop
  // whichever of its own pages shared a number with a forgotten one. Nothing
  // here shares a host with the disk fixture; the point is that the private
  // window ignores the summary regardless of what it says.
  const disk = await FOSContextEngine.store();
  const trailId = await disk.addTrail({ name: "cleared while private" });
  await disk.addNode({ trailId, url: "https://private-bystander.invalid/x" });
  await new Promise(resolve =>
    Services.clearData.deleteDataFromHost(
      "private-bystander.invalid",
      true,
      Ci.nsIClearDataService.CLEAR_HISTORY,
      { onDataDeleted: resolve }
    )
  );

  Assert.equal(
    tree.nodes().length,
    nodesBefore,
    "clearing history took nothing out of the live private session"
  );
  Assert.equal(
    await nodesUnder(engine.store, SECRET),
    1,
    "and left the private session's own record alone"
  );

  // The same claim with the collision forced. The disk store's ids and this
  // window's ids are drawn from different databases and both start at 1, so a
  // summary naming low ids is exactly what a normal profile produces after a
  // few pages — but the ids it names are somebody else's. Nothing above can
  // produce the collision on demand, because which ids the disk store hands out
  // is not something a test can choose; announcing the summary directly is the
  // only way to state the case that would actually lose a page.
  Services.obs.notifyObservers(
    null,
    FORGOTTEN_TOPIC,
    JSON.stringify({
      nodes: 3,
      queries: 0,
      contexts: 0,
      trails: 0,
      nodeIds: [1, 2, 3],
      contextIds: [1],
      all: false,
    })
  );
  await engine.settled;
  Assert.equal(
    tree.nodes().length,
    nodesBefore,
    "and a summary whose ids collide with this window's takes nothing either"
  );
  await endPrivateSession(win);
});

add_task(async function test_nothing_private_reaches_the_disk_at_all() {
  const win = await openPrivateWindow();
  const store = FOSContextEngine.forWindow(win).store;
  Assert.ok(
    store instanceof FOSContextStore,
    "the private session gets a real store rather than a stub, so every " +
      "query, migration and derivation runs against it unchanged"
  );
  await browse(win, `${SECRET}forensic`);
  await endPrivateSession(win);

  // The assertion the other tasks make through SQL, made the way somebody with
  // the machine afterwards would make it. A row can be deleted and still be
  // readable in the file, and the forensic literature on private browsing is
  // largely a catalogue of exactly that: not rows a browser meant to keep, but
  // pages, journals and free lists it never meant to write. Searching the bytes
  // is the only check here that cannot be satisfied by a delete.
  const base = PathUtils.join(PathUtils.profileDir, DATABASE_FILENAME);
  const decoder = new TextDecoder("latin1");
  for (const path of [base, `${base}-wal`, `${base}-journal`]) {
    if (!(await IOUtils.exists(path))) {
      continue;
    }
    const bytes = await IOUtils.read(path);
    Assert.ok(
      !decoder.decode(bytes).includes(SECRET),
      `no trace of the private session anywhere in ${PathUtils.filename(path)}`
    );
  }
});

add_task(async function test_never_remember_history_gets_the_same_treatment() {
  // "Never remember history" in `about:preferences`' data panel is permanent
  // private browsing: it sets `browser.privatebrowsing.autostart`, and every
  // window is then private without anybody asking for one. A user who picks it
  // has made the strongest statement the shipped UI offers about not being
  // recorded, and this component had never heard of the pref.
  //
  // It needs no code, because the engine asks `isWindowPrivate` rather than
  // reading a pref or watching how a window was opened, and that answers yes
  // here for the same reason it does for an explicit private window. This is
  // the assertion that says so, because "it follows from the API we happen to
  // call" is exactly the kind of claim that stops being true quietly.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.privatebrowsing.autostart", true]],
  });

  const win = await openPrivateWindow({ explicit: false });
  Assert.ok(
    PrivateBrowsingUtils.isWindowPrivate(win),
    "an ordinary window is private when the user asked never to be remembered"
  );

  const engine = FOSContextEngine.forWindow(win);
  Assert.equal(
    engine.store,
    await FOSContextEngine.privateStore(),
    "and its engine records to the memory store, not to the profile's file"
  );

  await browse(win, `${SECRET}autostart`);
  await engine.settled;
  const profileStore = await FOSContextEngine.store();
  Assert.equal(
    await nodesUnder(profileStore, `${SECRET}autostart`),
    0,
    "so nothing it visited reached the database on disk"
  );

  // Closing it does *not* drop the store, and that is right rather than a
  // leak: `last-pb-context-exited` fires when the last private window goes,
  // and under this pref the next window will be private too. There is no
  // session boundary to hang a teardown on until the process exits, which is
  // also when a memory database ceases to exist. Asserting it here because it
  // is the one place the private store's lifetime differs from §Private
  // browsing's description of it, and a reader of that section would guess
  // wrong.
  await BrowserTestUtils.closeWindow(win);
  Assert.ok(
    FOSContextEngine.privateStoreIsOpen,
    "the memory store outlives the window, because the mode outlives it too"
  );

  await SpecialPowers.popPrefEnv();
  // Left open, the store would be handed to the next private window in the
  // suite as if it were the same session — which is exactly what
  // `test_a_private_session_cannot_see_the_last_one` denies.
  await FOSContextEngine.resetStore();
});
