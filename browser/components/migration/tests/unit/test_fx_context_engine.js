/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * A profile refresh must carry the Context Engine's database forward.
 *
 * `FirefoxProfileMigrator` is what powers "Refresh", and it copies an explicit
 * list of files: history, favicons, cookies, passwords, form data, the
 * dictionary, bookmark backups and the session. Everything not on that list is
 * left behind deliberately, because the point of a refresh is to drop the
 * configuration that might be causing the trouble.
 *
 * The Context Engine's store is not configuration. It is every query typed,
 * the page each was typed from, how long each page was read and the names
 * given to whole afternoons of work, and it exists nowhere else. Left off the
 * list, a refresh hands back a browser whose rail, Field and sidebar are all
 * empty while its history and bookmarks are intact — and does it silently.
 */

"use strict";

const { FirefoxProfileMigrator } = ChromeUtils.importESModule(
  "resource:///modules/FirefoxProfileMigrator.sys.mjs"
);
const { DATABASE_FILENAME } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextStore.sys.mjs"
);

const JOURNAL = DATABASE_FILENAME + "-journal";

function testDirs() {
  const tempDir = do_get_tempdir();
  const dirs = [];
  for (const leaf of ["fos_source_dir", "fos_target_dir"]) {
    const dir = tempDir.clone();
    dir.append(leaf);
    dir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, FileUtils.PERMS_DIRECTORY);
    dirs.push(dir);
  }
  return dirs;
}

function write(dir, leafName, contents) {
  const file = dir.clone();
  file.append(leafName);
  const stream = FileUtils.openFileOutputStream(file);
  stream.write(contents, contents.length);
  stream.close();
}

function read(dir, leafName) {
  const file = dir.clone();
  file.append(leafName);
  if (!file.exists()) {
    return null;
  }
  const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream
  );
  stream.init(file, -1, -1, Ci.nsIFileInputStream.CLOSE_ON_EOF);
  const sis = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
    Ci.nsIScriptableInputStream
  );
  sis.init(stream);
  const contents = sis.read(file.fileSize);
  sis.close();
  return contents;
}

/**
 * Run one named resource, or return null if the migrator did not offer it.
 *
 * The distinction matters: a resource that is absent because the source
 * profile has no such file is correct, and a resource that is absent because
 * nobody added it is the defect this file exists to catch. Both look like
 * "nothing happened" from the target directory alone.
 *
 * @param {string} name The resource's name.
 * @param {nsIFile} srcDir The profile being refreshed from.
 * @param {nsIFile} targetDir The profile being refreshed into.
 * @returns {?object} The migration resource, or null.
 */
function resource(name, srcDir, targetDir) {
  // Startup-only migrator, so instantiate it directly rather than going
  // through MigrationUtils' availability check.
  const migrator = new FirefoxProfileMigrator();
  return (
    migrator
      .getResourcesInternal(srcDir, targetDir)
      .find(r => r.name == name) ?? null
  );
}

function migrate(res) {
  return new Promise(resolve => res.migrate(resolve));
}

add_task(async function test_database_is_carried_forward() {
  const [srcDir, targetDir] = testDirs();
  write(srcDir, DATABASE_FILENAME, "not really sqlite, but it is the bytes");

  const res = resource("contextEngine", srcDir, targetDir);
  Assert.ok(res, "a refresh offers the Context Engine's database");
  Assert.equal(
    res.type,
    MigrationUtils.resourceTypes.HISTORY,
    "under HISTORY, with places — it is a record of browsing, not a setting"
  );

  Assert.ok(await migrate(res), "the copy succeeds");
  Assert.equal(
    read(targetDir, DATABASE_FILENAME),
    "not really sqlite, but it is the bytes",
    "the refreshed profile has the database, byte for byte"
  );
});

add_task(async function test_journal_comes_with_it() {
  const [srcDir, targetDir] = testDirs();
  write(srcDir, DATABASE_FILENAME, "database");
  write(srcDir, JOURNAL, "hot journal from a crash");

  await migrate(resource("contextEngine", srcDir, targetDir));

  // Without this the refreshed profile gets a database that SQLite cannot
  // roll back, which is how a recoverable crash becomes an unreadable file.
  Assert.equal(
    read(targetDir, JOURNAL),
    "hot journal from a crash",
    "the rollback journal is copied alongside its database"
  );
});

add_task(async function test_absent_database_offers_nothing() {
  const [srcDir, targetDir] = testDirs();

  Assert.equal(
    resource("contextEngine", srcDir, targetDir),
    null,
    "a profile that never ran the Context Engine offers no such resource"
  );
  Assert.equal(
    read(targetDir, DATABASE_FILENAME),
    null,
    "and nothing is created in the refreshed profile"
  );
});

add_task(async function test_it_travels_with_places() {
  const [srcDir, targetDir] = testDirs();
  write(srcDir, DATABASE_FILENAME, "context engine");
  write(srcDir, "places.sqlite", "places");

  // The contract is not "there exists a resource somewhere" but that a
  // HISTORY migration carries both. `MigrationUtils` runs resources by type,
  // so a resource built correctly and left out of the returned list is
  // invisible in exactly the same way as one never written.
  const migrator = new FirefoxProfileMigrator();
  const history = migrator
    .getResourcesInternal(srcDir, targetDir)
    .filter(r => r.type == MigrationUtils.resourceTypes.HISTORY);

  for (const res of history) {
    await migrate(res);
  }

  Assert.equal(read(targetDir, "places.sqlite"), "places", "history came");
  Assert.equal(
    read(targetDir, DATABASE_FILENAME),
    "context engine",
    "and so did the record that gives this browser its interface"
  );
});
