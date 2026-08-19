/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * `design/GRAMMAR.md` §5.1, checked against the window rather than the table.
 *
 * The rule is that no action may exist which only one input modality can
 * reach. The action table satisfies it by construction, and §5.1 used to claim
 * the whole browser did on that basis — which does not follow, and cost a
 * corrupted trail tree for as many runs as it took to count the keyset instead
 * of arguing from the table. See `ARCHITECTURE.md` §7.
 *
 * So: enumerate the keys this window actually has, and require that every
 * command they reach appears in `keyset-manifest.js` with a class and a written
 * reason. A new binding — ours or one that arrives with an upstream merge —
 * fails this file until somebody has decided what §5 makes of it. A binding
 * that goes away fails it too, so the manifest cannot silently become a list of
 * commands that no longer exist.
 *
 * What this file deliberately does not do is fail on `debt`. There are real §5
 * violations in the manifest today and hiding them behind a red suite would get
 * the file disabled, not the debt paid. The check is that nothing is
 * *unexamined*; the debt entries are the examined ones that lost.
 *
 * The enumeration runs in a real window because the source is a bad proxy for
 * it: `#ifdef` and platform blocks mean the file and the window disagree, and
 * devtools installs its keys at window load rather than declaring them in the
 * markup.
 */

/* import-globals-from keyset-manifest.js */

const { ACTIONS } = ChromeUtils.importESModule(
  "resource:///modules/FOSGrammar.sys.mjs"
);

Services.scriptloader.loadSubScript(
  getRootDirectory(gTestPath) + "keyset-manifest.js",
  this
);

/**
 * What a key is keyed by in the manifest.
 *
 * The `command` attribute when there is one — that is the thing being run, and
 * several keys usually reach the same one. When there is none, the key runs
 * whatever a listener elsewhere makes of it, which is still something the user
 * did and still needs classifying, so it is keyed by its own id.
 *
 * @param {Element} key A `<key>` element.
 * @returns {string} The manifest key.
 */
function commandOf(key) {
  return key.getAttribute("command") || `key#${key.id || "anonymous"}`;
}

/**
 * How a key is pressed, for the log. Not asserted on — the manifest is about
 * what a command *is*, not which gesture reaches it, and the gestures differ
 * per platform while the classification does not.
 *
 * @param {Element} key A `<key>` element.
 * @returns {string} A human-readable shortcut.
 */
function gestureOf(key) {
  const mods = key.getAttribute("modifiers");
  const stroke = key.getAttribute("key") || key.getAttribute("keycode") || "?";
  return (mods ? `${mods.replace(/[, ]+/g, "+")}+` : "") + stroke;
}

/**
 * Every command the window's keys can reach, with the keys that reach it.
 *
 * @param {Window} win The chrome window.
 * @returns {Map<string, object[]>} Command → the keys bound to it.
 */
function enumerateKeyset(win) {
  const byCommand = new Map();
  for (const key of win.document.querySelectorAll("key")) {
    const command = commandOf(key);
    if (!byCommand.has(command)) {
      byCommand.set(command, []);
    }
    byCommand.get(command).push({
      id: key.id || "",
      gesture: gestureOf(key),
      disabled: key.getAttribute("disabled") === "true",
      internal: key.getAttribute("internal") === "true",
      inline: key.hasAttribute("oncommand"),
    });
  }
  return byCommand;
}

add_task(async function test_keyset_is_enumerable() {
  const byCommand = enumerateKeyset(window);
  const keyCount = window.document.querySelectorAll("key").length;

  info(`keyset: ${keyCount} keys reaching ${byCommand.size} commands`);
  for (const command of [...byCommand.keys()].sort()) {
    const bindings = byCommand
      .get(command)
      .map(
        b =>
          `${b.gesture}${b.id ? ` (${b.id})` : ""}` +
          `${b.disabled ? " [disabled]" : ""}` +
          `${b.internal ? " [internal]" : ""}` +
          `${b.inline ? " [oncommand]" : ""}`
      )
      .join(", ");
    const entry = KEYSET_MANIFEST[command];
    info(`  ${entry?.class ?? "UNCLASSIFIED"}\t${command}\t${bindings}`);
  }

  Assert.greater(
    byCommand.size,
    0,
    "the window binds keys at all — a zero here means the enumeration is wrong, " +
      "not that the browser has no shortcuts"
  );
});

add_task(async function test_every_command_is_classified() {
  const byCommand = enumerateKeyset(window);

  const unclassified = [...byCommand.keys()]
    .filter(command => !Object.hasOwn(KEYSET_MANIFEST, command))
    .sort();

  Assert.deepEqual(
    unclassified,
    [],
    "every command a key reaches is classified in keyset-manifest.js. " +
      "A new one here is not a test failure to route around: GRAMMAR.md §5 " +
      "asks what modality can reach it, and the manifest is where that answer " +
      "is written down"
  );
});

add_task(async function test_manifest_has_no_stale_entries() {
  const byCommand = enumerateKeyset(window);

  const stale = Object.keys(KEYSET_MANIFEST)
    .filter(command => !byCommand.has(command))
    .sort();

  Assert.deepEqual(
    stale,
    [],
    "every manifest entry names a command the window still binds. Without " +
      "this the manifest decays into a list of decisions about things that " +
      "are gone, and reads as coverage it no longer has"
  );
});

add_task(async function test_every_entry_is_answerable() {
  for (const [command, entry] of Object.entries(KEYSET_MANIFEST)) {
    Assert.ok(
      Object.hasOwn(KEY_CLASSES, entry.class),
      `${command}: class "${entry.class}" is one of the declared classes`
    );
    Assert.greater(
      (entry.reason ?? "").length,
      20,
      `${command}: has a written reason, not a restatement of its class. ` +
        `The class is the shelf; the reason is the argument`
    );
  }
});

add_task(async function test_verb_entries_name_a_live_verb() {
  for (const [command, entry] of Object.entries(KEYSET_MANIFEST)) {
    if (entry.class != "verb") {
      Assert.ok(!entry.verb, `${command}: only a "verb" entry names a verb`);
      continue;
    }
    Assert.ok(
      entry.verb && Object.hasOwn(ACTIONS, entry.verb),
      `${command}: names "${entry.verb}", which is a verb in the action ` +
        `table. A renamed verb must not leave a command claiming to be ` +
        `spoken for by a word nobody can say`
    );
  }
});

add_task(async function test_unbound_entries_are_actually_unbound() {
  const byCommand = enumerateKeyset(window);

  for (const [command, entry] of Object.entries(KEYSET_MANIFEST)) {
    if (entry.class != "unbound") {
      continue;
    }
    // `unbound` is the one exemption that is a fact about the window rather
    // than a judgement about the action, so it is the one that can be checked
    // outright — and it has to be, or it becomes the shelf every awkward
    // binding gets parked on.
    const bound = byCommand
      .get(command)
      .filter(binding => !binding.gesture.endsWith("?"));
    Assert.deepEqual(
      bound.map(b => b.gesture),
      [],
      `${command}: claims "unbound", and no key reaching it carries a ` +
        `keystroke. A keystroke here means the command is reachable by hand ` +
        `after all, and the entry is debt`
    );
  }
});

add_task(async function test_the_debt_is_stated_rather_than_counted() {
  const debt = Object.entries(KEYSET_MANIFEST)
    .filter(([, entry]) => entry.class == "debt")
    .map(([command]) => command)
    .sort();

  // Not an assertion about the number. A ratchet on the count would be
  // satisfied by reclassifying, which is the one move this file exists to
  // prevent, and a new unvoiced command fails the classification check anyway.
  info(`§5 debt: ${debt.length} command(s) reachable by hand only`);
  for (const command of debt) {
    info(`  ${command}: ${KEYSET_MANIFEST[command].reason}`);
  }
});
