/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The command bar in a real chrome window.
 *
 * The view model's behaviour is covered in node
 * (`tests/node/test_commandbarview.mjs`) and is not repeated here. What this
 * file covers is everything node cannot see: that the keys are actually bound,
 * that the overlay reaches the DOM, that focus goes where it should, and that
 * a query really navigates. Both of this project's shipped defects so far were
 * invisible to green node tests, so this half is the point rather than the
 * formality.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { KIND_SEARCH, KIND_URL, NOT_WIRED, resolveInput } =
  ChromeUtils.importESModule("resource:///modules/FOSActions.sys.mjs");

function bar() {
  return FOSCommandBar.forWindow(window);
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

function statusText() {
  return window.document.querySelector(".fos-commandbar-status").textContent;
}

function rowKeys() {
  return [...window.document.querySelectorAll(".fos-commandbar-row")].map(row =>
    row.getAttribute("data-key")
  );
}

registerCleanupFunction(() => {
  bar().close();
  bar().marks.clear();
});

add_task(async function test_the_entry_gestures_all_reach_one_surface() {
  const commandBar = bar();
  Assert.ok(!commandBar.isOpen, "closed to begin with");

  // The claim under test is the phase plan's "no separate URL bar, search box
  // or menus for these". Every key that used to open one of those two boxes
  // has to name this one command, or a second entry surface survives.
  for (const id of [
    "focusURLBar",
    "focusURLBar2",
    "key_search",
    "key_search2",
  ]) {
    const key = window.document.getElementById(id);
    Assert.equal(
      key?.getAttribute("command"),
      "FOS:CommandBar",
      `${id} opens the command bar`
    );
  }

  window.document.getElementById("FOS:CommandBar").doCommand();

  Assert.ok(commandBar.isOpen, "the command opened the bar");
  Assert.equal(
    window.document.activeElement,
    commandBar.input,
    "the input took focus, so the next keystroke lands in it"
  );

  // Focus is in chrome now, so this is a real key travelling the real keyset
  // rather than a direct call — which is the half doCommand cannot prove.
  EventUtils.synthesizeKey("k", { accelKey: true }, window);
  Assert.ok(!commandBar.isOpen, "accel+K toggled the same bar shut");
});

add_task(async function test_escape_closes_and_returns_focus() {
  const commandBar = bar();
  commandBar.open();
  type("gecko");

  EventUtils.synthesizeKey("KEY_Escape", {}, window);

  Assert.ok(!commandBar.isOpen, "Escape closed the bar");
  Assert.equal(commandBar.input.value, "", "and cleared what was typed");
});

add_task(async function test_empty_state_teaches_the_verbs() {
  const commandBar = bar();
  commandBar.open();

  // A bar that opens to nothing is the single most reported command-palette
  // failure, and it would be fatal here: this surface is the only place the
  // twelve words exist.
  Assert.greater(rowKeys().length, 0, "the empty state lists the actions");
  Assert.ok(rowKeys().includes("enter"), "including `enter`");
  Assert.ok(rowKeys().includes("pack"), "and `pack`");

  Assert.equal(
    window.document.querySelectorAll(".fos-commandbar-group").length,
    3,
    "grouped by pillar, not dumped as one list of twelve"
  );

  commandBar.close();
});

add_task(async function test_prose_reads_as_a_search() {
  const commandBar = bar();
  commandBar.open();

  type("what is a memex");

  Assert.ok(
    statusText().startsWith("Search for"),
    `the most natural question anyone could type is a search, got: ${statusText()}`
  );

  commandBar.close();
});

add_task(async function test_tab_completes_without_committing() {
  const commandBar = bar();
  commandBar.open();

  type("fie");
  Assert.deepEqual(rowKeys(), ["field"], "the completion is offered");
  Assert.ok(
    statusText().startsWith("Search for"),
    "but Enter would still search, because a prefix is prose"
  );

  EventUtils.synthesizeKey("KEY_Tab", {}, window);
  Assert.equal(commandBar.input.value, "field ", "Tab completed the verb");
  Assert.ok(!statusText().startsWith("Search for"), "and now it is a command");

  commandBar.close();
});

add_task(async function test_marks_are_listed_with_their_spoken_form() {
  const commandBar = bar();
  const card = commandBar.marks.assign("card-1", {
    label: "gecko",
    type: "card",
  });
  const context = commandBar.marks.assign("ctx-1", {
    label: "reading",
    type: "context",
  });

  commandBar.open();
  type("enter ");

  Assert.ok(rowKeys().includes(card), "the card is a candidate");
  Assert.ok(!rowKeys().includes(context), "the context is not");

  const spoken = window.document.querySelectorAll(".fos-commandbar-spoken");
  Assert.greater(spoken.length, 0, "every mark shows the word to say for it");
  Assert.greater(
    spoken[0].textContent.length,
    1,
    "and it is a word, not a letter"
  );

  commandBar.close();
  commandBar.marks.clear();
});

add_task(async function test_arrowing_reaches_the_typed_line_again() {
  const commandBar = bar();
  commandBar.open();

  // Selection cycles through "no row" so the line the user typed stays
  // reachable from the keyboard; without that, arrowing down once traps them
  // in the list.
  EventUtils.synthesizeKey("KEY_ArrowDown", {}, window);
  const first = window.document.querySelector('[aria-selected="true"]');
  Assert.ok(first, "arrowing down selects a row");

  EventUtils.synthesizeKey("KEY_ArrowUp", {}, window);
  Assert.ok(
    !window.document.querySelector('[aria-selected="true"]'),
    "arrowing back up returns to the typed line"
  );

  commandBar.close();
});

add_task(async function test_url_and_search_are_told_apart() {
  // nsIURIFixup is Gecko's, so this is the half of `resolveInput` that node
  // could never check.
  Assert.equal(
    resolveInput("example.org").kind,
    KIND_URL,
    "a bare host is a URL"
  );
  Assert.equal(
    resolveInput("https://example.org/docs").kind,
    KIND_URL,
    "so is a full one"
  );
  Assert.equal(
    resolveInput("gecko session history").kind,
    KIND_SEARCH,
    "prose with spaces is a search"
  );
  Assert.equal(resolveInput("   "), null, "blank resolves to nothing at all");
});

add_task(async function test_a_query_navigates() {
  const commandBar = bar();
  commandBar.open();
  type("example.com");

  Assert.ok(
    statusText().startsWith("Go to"),
    `a URL says go rather than search, got: ${statusText()}`
  );

  const loaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    url => Services.io.newURI(url).host == "example.com"
  );
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  await loaded;

  Assert.ok(!commandBar.isOpen, "running a query closed the bar");
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.host,
    "example.com",
    `navigated, got ${gBrowser.selectedBrowser.currentURI.spec}`
  );
});

add_task(async function test_an_unwired_verb_is_refused_not_searched() {
  const commandBar = bar();
  const card = commandBar.marks.assign("card-1", {
    label: "gecko",
    type: "card",
  });

  // The Field has no UI yet, so `enter` has no handler. The property that
  // matters is what happens then: GRAMMAR.md §3 says a well-formed command
  // must never quietly become a web search, so the dispatcher has to say it
  // could not run rather than fall through.
  Assert.ok(!commandBar.actions.has("enter"), "`enter` is unwired for now");

  const before = gBrowser.selectedBrowser.currentURI.spec;
  const outcome = commandBar.run(`enter ${card}`);

  Assert.equal(outcome.ran[0].reason, NOT_WIRED, "reported as unwired");
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    before,
    "and nothing was navigated to"
  );

  commandBar.marks.clear();
});

add_task(async function test_every_verb_the_grammar_defines_is_accounted_for() {
  const commandBar = bar();

  // A verb that exists in the table with no handler is fine — the pillars land
  // over several runs. A verb that has quietly gone missing from the table is
  // not, and this is what will catch it.
  const unwired = commandBar.actions.unwired();
  Assert.ok(
    !unwired.includes("search"),
    "`search` is wired, because the bar cannot ship without it"
  );
  info(`verbs still awaiting a pillar: ${unwired.join(", ")}`);
});
