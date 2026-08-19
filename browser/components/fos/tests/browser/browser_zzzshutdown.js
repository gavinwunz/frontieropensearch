/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * "Clear history when the browser closes" actually clears the Context Engine.
 *
 * This is the nastiest of the integration points listed in
 * `design/ARCHITECTURE.md` §7, because the user has asked for exactly this and
 * would have no way of finding out they did not get it: the browser is closing,
 * and the next launch shows a rail and a Field rebuilt from a database that was
 * supposed to be empty.
 *
 * Reading says it works — shutdown sanitization blocks Places' clients
 * shutdown, and its history item clears `CLEAR_HISTORY`, which is the flag the
 * Context Engine registers under. This file is here because a claim about
 * shutdown ordering that nothing executes is a claim with an expiry date on it.
 *
 * **This file must stay last in the manifest.** It runs the real shutdown
 * sanitizer, which clears the whole profile — the Context Engine's database
 * included — so every fixture any earlier file left behind goes with it.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { DATABASE_FILENAME, movedAsideDatabases } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextStore.sys.mjs"
);

add_task(async function test_clear_on_shutdown_reaches_the_context_engine() {
  const store = await FOSContextEngine.store();
  const trailId = await store.addTrail({ name: "still here at shutdown" });
  await store.addNode({ trailId, url: "https://shutdown.invalid/page" });
  await store.recordQuery({ raw: "asked before the browser closed" });

  const [before] = await store.connection.execute(
    "SELECT COUNT(*) AS n FROM trail_node"
  );
  Assert.greater(
    before.getResultByName("n"),
    0,
    "the database has something in it to lose"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.sanitize.sanitizeOnShutdown", true],
      ["privacy.clearOnShutdown_v2.browsingHistoryAndDownloads", true],
      ["privacy.clearOnShutdown_v2.cache", false],
      ["privacy.clearOnShutdown_v2.cookiesAndStorage", false],
      ["privacy.clearOnShutdown_v2.formdata", false],
      ["privacy.clearOnShutdown_v2.siteSettings", false],
    ],
  });

  await Sanitizer.runSanitizeOnShutdown();

  const [after] = await store.connection.execute(
    "SELECT COUNT(*) AS n FROM trail_node"
  );
  Assert.equal(
    after.getResultByName("n"),
    0,
    "clearing history on shutdown emptied the Context Engine's trails"
  );
  const [queries] = await store.connection.execute(
    "SELECT COUNT(*) AS n FROM query"
  );
  Assert.equal(
    queries.getResultByName("n"),
    0,
    "and took the searches that were typed with them"
  );

  // The ordering claim, stated as an assertion rather than as a paragraph: the
  // clear ran at `profile-change-teardown`, and the connection it ran against
  // is still the live one, so nothing raced the database being closed.
  const [alive] = await store.connection.execute("SELECT 1 AS ok");
  Assert.equal(
    alive.getResultByName("ok"),
    1,
    "and the store is still open afterwards, as it is during a real shutdown"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_clearing_also_takes_a_database_moved_aside() {
  // `FOSContextStore.open` keeps a database it cannot read instead of
  // deleting it, because nothing in it exists anywhere else. That is only
  // defensible while clearing still reaches it, and this is the assertion
  // that says so through the real path rather than by calling the sweep: a
  // file the user cannot see, that "clear everything" leaves behind, is
  // precisely the defect `FOSForget` was written to remove.
  //
  // It runs here rather than in `browser_zzforget.js` because only a clear of
  // *everything* sweeps, and this is the one file in the directory allowed to
  // empty the profile.
  const planted = PathUtils.join(
    PathUtils.profileDir,
    DATABASE_FILENAME + ".corrupt"
  );
  await IOUtils.writeUTF8(planted, "whatever was left of an unreadable store");
  Assert.ok(
    (await movedAsideDatabases()).includes(planted),
    "the sweep can see it before the clear"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.sanitize.sanitizeOnShutdown", true],
      ["privacy.clearOnShutdown_v2.browsingHistoryAndDownloads", true],
      ["privacy.clearOnShutdown_v2.cache", false],
      ["privacy.clearOnShutdown_v2.cookiesAndStorage", false],
      ["privacy.clearOnShutdown_v2.formdata", false],
      ["privacy.clearOnShutdown_v2.siteSettings", false],
    ],
  });

  await Sanitizer.runSanitizeOnShutdown();

  Assert.ok(
    !(await IOUtils.exists(planted)),
    "clearing history removed it, so nothing outlives the clear"
  );

  await SpecialPowers.popPrefEnv();
});
