/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * What a surface pref being false gives back.
 *
 * Each of this fork's three chrome surfaces has a pref that turns it off, and
 * each of those prefs is a promise to somebody who is not this project: the
 * `browser.toml` of an upstream directory whose tests drive the chrome the
 * surface replaced. So the promise has to be checked the way those tests will
 * cash it — by opening a window with the pref off and pressing the key — and
 * not by reading the module that honours it.
 *
 * The failure this file exists to stop is specific and it is not a wrong
 * answer. `replacesAddressBar=false` restored a typable address bar and left
 * accel+L pointing at the command bar, so an upstream test that focuses the
 * urlbar by keystroke and waits for it **hung**: no failure, no output, four
 * timeout extensions and a harness that had to be killed by hand. A pref that
 * half-restores is worse than one that does nothing, because a test suite can
 * report the second and can only stall on the first.
 *
 * Every assertion here therefore has a deadline. `waitForCondition` and
 * `waitForEvent` both reject rather than hanging, which is what turns the
 * regression back into a failure someone can read.
 */

const REBOUND = [
  { id: "focusURLBar", key: "l", modifiers: { accelKey: true } },
  { id: "focusURLBar2", key: "d", modifiers: { altKey: true } },
  { id: "key_search", key: "k", modifiers: { accelKey: true } },
  { id: "key_search2", key: "e", modifiers: { accelKey: true } },
  { id: "key_gotoHistory", key: "h", modifiers: { accelKey: true } },
];

const ADDRESS_BAR_OFF = [["browser.fos.commandBar.replacesAddressBar", false]];

/**
 * Open a window with prefs set, run against it, and close it.
 *
 * The prefs must be in place *before* the window opens: the rebinding runs at
 * `MozBeforeInitialXULLayout`, so a window that is already up has already
 * decided. That is the right seam — a key is a document's, not a session's —
 * but it means every check here costs a window.
 *
 * @param {Array<[string, boolean]>} prefs Prefs to set for the window's life.
 * @param {Function} body Called with the new window.
 */
async function withWindow(prefs, body) {
  await SpecialPowers.pushPrefEnv({ set: prefs });
  const win = await BrowserTestUtils.openNewBrowserWindow();
  try {
    await body(win);
  } finally {
    await BrowserTestUtils.closeWindow(win);
    await SpecialPowers.popPrefEnv();
  }
}

add_task(async function table_names_real_keys() {
  // A rebinding table is a claim about a document and it fails silently in the
  // direction that looks like success: an id that matches nothing simply
  // leaves the key pointing at the FOS command, which is indistinguishable
  // from the pref being on. Checked against the window this test runs in,
  // where the prefs are at their defaults and nothing has been rewritten.
  for (const { id } of REBOUND) {
    Assert.ok(
      document.getElementById(id),
      `${id} exists on this platform, so the table entry is live`
    );
  }
});

add_task(async function keys_point_at_fos_by_default() {
  Assert.equal(
    document.getElementById("focusURLBar").getAttribute("command"),
    "FOS:CommandBar",
    "accel+L opens the command bar while the pref is on"
  );
  Assert.equal(
    document.getElementById("key_search").getAttribute("command"),
    "FOS:CommandBar",
    "and so does accel+K, which is the whole point of one entry surface"
  );
  Assert.equal(
    document.getElementById("key_gotoHistory").getAttribute("command"),
    "FOS:TrailRail",
    "and the history sidebar's key opens the rail"
  );
});

add_task(async function address_bar_pref_restores_its_four_keys() {
  await withWindow(ADDRESS_BAR_OFF, async win => {
    const doc = win.document;
    Assert.equal(
      doc.getElementById("focusURLBar").getAttribute("command"),
      "Browser:OpenLocation",
      "accel+L means open-location again"
    );
    Assert.equal(
      doc.getElementById("focusURLBar2").getAttribute("command"),
      "Browser:OpenLocation",
      "and so does alt+D"
    );
    // Not `Browser:OpenLocation`: accel+K was the search box, and one FOS
    // command id stood in for two upstream ones. Restoring both to the same
    // command would look right in a window and would be wrong.
    Assert.equal(
      doc.getElementById("key_search").getAttribute("command"),
      "Tools:Search",
      "accel+K means web search again, not open-location"
    );
    Assert.equal(
      doc.getElementById("key_search2").getAttribute("command"),
      "Tools:Search",
      "and so does accel+E"
    );
    Assert.equal(
      doc.getElementById("key_gotoHistory").getAttribute("command"),
      "FOS:TrailRail",
      "and the rail's key is untouched — one pref restores one surface"
    );
  });
});

add_task(async function accel_l_actually_focuses_the_address_bar() {
  // The assertion the hang was hiding. Rewriting the attribute is only the
  // mechanism; what upstream's tests wait on is focus arriving in the input,
  // and a `<key>` resolving its command at dispatch rather than at parse is
  // the thing that makes a runtime rewrite work at all.
  await withWindow(ADDRESS_BAR_OFF, async win => {
    Assert.ok(!win.gURLBar.readOnly, "the address bar takes typing again");
    win.gBrowser.selectedBrowser.focus();
    Assert.ok(!win.gURLBar.focused, "and does not start focused");

    EventUtils.synthesizeKey("l", { accelKey: true }, win);
    await TestUtils.waitForCondition(
      () => win.gURLBar.focused,
      "accel+L put focus in the address bar"
    );

    // And the command bar did not also open behind it, which is what a rewrite
    // that added a path rather than replacing one would do.
    Assert.ok(
      !win.document.querySelector(".fos-commandbar"),
      "and the command bar was never built in this window"
    );
  });
});

add_task(async function accel_l_opens_the_command_bar_by_default() {
  // The other half of the same claim, in a window with the prefs at their
  // defaults: the restoration is conditional, and a test that only checked the
  // restored side would pass with the pref read inverted.
  await withWindow([], async win => {
    win.gBrowser.selectedBrowser.focus();
    EventUtils.synthesizeKey("l", { accelKey: true }, win);
    await TestUtils.waitForCondition(
      () => win.document.querySelector(".fos-commandbar"),
      "accel+L opened the command bar"
    );
    Assert.ok(
      !win.gURLBar.focused,
      "and focus did not go to the address bar instead"
    );
  });
});

add_task(async function trail_rail_pref_restores_the_history_sidebar() {
  // This key is the odd one: upstream gives it no `command` at all and
  // dispatches it by id from the keyset listener, so restoring it means
  // removing an attribute rather than rewriting one. A table that only knew
  // how to rewrite would have had to invent a command id that does not exist,
  // and the key would have thrown at every press.
  await withWindow(
    [["browser.fos.trailRail.replacesHistorySidebar", false]],
    async win => {
      Assert.ok(
        !win.document.getElementById("key_gotoHistory").hasAttribute("command"),
        "the key carries no command, exactly as upstream ships it"
      );
      Assert.equal(
        win.document.getElementById("focusURLBar").getAttribute("command"),
        "FOS:CommandBar",
        "and the command bar's keys are untouched"
      );
    }
  );
});

add_task(async function show_all_tabs_follows_the_field_pref() {
  // Not a key: `Browser:ShowAllTabs` is the strip's own overflow button, and
  // with the strip drawn again it has to open the strip's panel rather than
  // the surface that replaced the strip. Same promise, different mechanism —
  // the pref is read in the command handler, since there is no attribute to
  // rewrite — so it is checked separately.
  await withWindow(
    [["browser.fos.field.replacesTabStrip", false]],
    async win => {
      // The panel lives in a `<html:template>` until something asks for it, so
      // there is no element to wait on before this call.
      win.gTabsPanel.initElements();
      const view = win.document.getElementById("allTabsMenu-allTabsView");
      const shown = BrowserTestUtils.waitForEvent(view, "ViewShown");
      win.document.getElementById("Browser:ShowAllTabs").doCommand();
      await shown;
      Assert.ok(
        !win.document.querySelector(".fos-field"),
        "the strip's own panel opened, and the Field was not built"
      );
      const hidden = BrowserTestUtils.waitForEvent(
        view.panelMultiView,
        "PanelMultiViewHidden"
      );
      win.gTabsPanel.hideAllTabsPanel();
      await hidden;
    }
  );
});

add_task(async function show_all_tabs_opens_the_field_by_default() {
  await withWindow([], async win => {
    win.document.getElementById("Browser:ShowAllTabs").doCommand();
    await TestUtils.waitForCondition(
      () => win.document.querySelector(".fos-field"),
      "with the Field replacing the strip, show-all-tabs opens the Field"
    );
  });
});
