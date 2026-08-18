/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The address bar, retired as an input and kept as a display.
 *
 * Two claims are made here and both have to be checked in a real window,
 * because both are about a shipped element this component does not own. The
 * first is that text cannot be entered into it and a press opens the command
 * bar instead. The second is the one that would be quiet if it broke: the
 * origin is still shown. A change that made the address bar read-only *and*
 * blank would pass every test about the command bar and would be the exact
 * defect — chrome that hides where the user is — that keeping this element was
 * meant to avoid.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSLocationDisplay, PASSTHROUGH } = ChromeUtils.importESModule(
  "resource:///modules/FOSLocationDisplay.sys.mjs"
);
const { FOSFieldSurface } = ChromeUtils.importESModule(
  "resource:///modules/FOSFieldSurface.sys.mjs"
);

const PAGE = "https://example.com/";

function bar() {
  return FOSCommandBar.forWindow(window);
}

function display() {
  return FOSLocationDisplay.forWindow(window);
}

registerCleanupFunction(() => {
  bar().close();
});

add_task(async function wired_at_window_init() {
  Assert.ok(
    display().isWired,
    "the address bar was retired when the window opened"
  );
  Assert.ok(gURLBar.readOnly, "and it is read-only");
  Assert.ok(
    gURLBar.inputField.readOnly,
    "down to the input field, which is what stops typing"
  );
  // `readOnly` is a property of the field and says nothing about how it looks,
  // so this passed with an I-beam still sitting over a bar that refuses a
  // caret — a control advertising an input it will not accept. Found by
  // looking at a screenshot, and asserted here so it cannot come back.
  Assert.equal(
    window.getComputedStyle(gURLBar.inputField).cursor,
    "pointer",
    "and it points, because it is a control now rather than a field"
  );
});

add_task(async function the_origin_is_still_shown() {
  await BrowserTestUtils.withNewTab(PAGE, async () => {
    await TestUtils.waitForCondition(
      () => gURLBar.value.includes("example.com"),
      "the address bar shows the origin of the page in front"
    );
    Assert.ok(
      !BrowserTestUtils.isHidden(gURLBar),
      "and it is visible, which is the whole reason it was kept"
    );
  });
});

add_task(async function a_press_opens_the_command_bar() {
  bar().close();
  Assert.ok(!bar().isOpen, "the command bar starts closed");

  EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);

  Assert.ok(bar().isOpen, "pressing the address bar opened the command bar");
  Assert.equal(bar().input.value, "", "empty, ready for a destination");
  Assert.equal(
    document.activeElement,
    bar().input,
    "and the focus is in the command bar, not the address bar"
  );
  bar().close();
});

add_task(async function the_mouse_can_reach_the_field_from_here() {
  // The claim this whole file exists to make: with no tab strip and no typable
  // address bar, a mouse still has a complete path to every surface, because
  // the one press it has left opens the grammar rather than a text field.
  // Pressing, typing a verb and running it is that path end to end.
  bar().close();
  EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);
  Assert.ok(bar().isOpen, "pressed the address bar");

  const surface = FOSFieldSurface.forWindow(window);
  bar().run("field");
  await TestUtils.waitForCondition(() => surface.isOpen, "the Field opened");
  Assert.ok(
    surface.isOpen,
    "running `field` from a bar opened by mouse showed the Field"
  );

  surface.close();
  bar().close();
});

add_task(async function the_site_information_control_keeps_its_own_press() {
  await BrowserTestUtils.withNewTab(PAGE, async () => {
    bar().close();

    // Which element carries site information depends on whether the trust
    // panel is gated on in this build, and the test should not care: what it
    // is checking is that whichever one the user can actually press still
    // belongs to the security surface rather than to the command bar.
    const control = ["#trust-icon-container", "#identity-box"]
      .map(selector => document.querySelector(selector))
      .find(
        element =>
          element &&
          !BrowserTestUtils.isHidden(element) &&
          element.getBoundingClientRect().width > 0
      );
    Assert.ok(
      control,
      "the address bar still offers a site-information control to press"
    );

    EventUtils.synthesizeMouseAtCenter(control, {}, window);

    Assert.ok(
      !bar().isOpen,
      "and pressing it was not swallowed by the command bar"
    );

    for (const id of ["identity-popup", "trustpanel-popup"]) {
      const panel = document.getElementById(id);
      if (panel?.state == "open") {
        const hidden = BrowserTestUtils.waitForEvent(panel, "popuphidden");
        panel.hidePopup();
        await hidden;
      }
    }
  });
});

add_task(async function a_secondary_press_is_left_alone() {
  bar().close();
  EventUtils.synthesizeMouseAtCenter(
    gURLBar.inputField,
    { type: "mousedown", button: 2 },
    window
  );
  EventUtils.synthesizeMouseAtCenter(
    gURLBar.inputField,
    { type: "mouseup", button: 2 },
    window
  );
  Assert.ok(
    !bar().isOpen,
    "right-click still belongs to the context menu, so the URL can be copied"
  );
});

/**
 * The bar no longer invites the typing it refuses.
 *
 * Upstream's placeholder is an instruction to type here, and this bar will not
 * take a keystroke. It is also the one string a first run is guaranteed to
 * see, since a placeholder shows only when there is no address.
 */
add_task(async function the_placeholder_describes_a_press() {
  const input = gURLBar.inputField;
  Assert.ok(
    !input.hasAttribute("data-l10n-id"),
    "Fluent no longer owns the placeholder, so it cannot put its own back"
  );
  Assert.equal(
    input.getAttribute("placeholder"),
    "Press to search or run a command",
    "and it describes what a press does rather than what typing would"
  );
  Assert.ok(
    !input.getAttribute("placeholder").includes("enter address"),
    "nothing left that asks for typing this bar refuses"
  );
});

/**
 * Every selector that keeps its own press names an element that exists.
 *
 * This is the test the list needed and did not have. Two of its seven entries
 * were dead — `#urlbar-searchmode-switcher` and `#urlbar-go-button` — because
 * the address bar became a custom element shared with the search bar and what
 * were ids on a singleton became classes on a reusable one. A selector that
 * matches nothing fails silently, and in the direction that looks safe: the
 * control quietly loses its press to the command bar, which is indistinguishable
 * from working until someone tries that control. Reading the list cannot catch
 * it; only asking a real window can.
 */
add_task(async function every_passthrough_selector_names_a_real_element() {
  await BrowserTestUtils.withNewTab(PAGE, async () => {
    for (const selector of PASSTHROUGH) {
      Assert.ok(
        gURLBar.querySelector(selector),
        `${selector} names an element inside the address bar`
      );
    }
  });
});

/**
 * The search-mode switcher is gone, and with it the second entry surface.
 *
 * It is upstream's unified search button: it wears the default engine's own
 * icon — Google's, in an ordinary profile — and opens a list of twelve places
 * to search. It is on-screen whenever `pageproxystate` is `invalid`, which is
 * every blank tab, so it is the state a fresh window opens on rather than a
 * corner.
 *
 * Everything it offers is unreachable here, which was checked before it was
 * removed rather than assumed: picking an engine set the search mode, painted
 * the engine's name as a chiclet and focused the input, and the input is
 * read-only, so the next keystroke went nowhere and the value stayed empty.
 * A control depicting a third party's brand that can accomplish none of what it
 * depicts is worse than no control.
 */
add_task(async function the_search_mode_switcher_is_gone() {
  // about:blank, because that is the `pageproxystate="invalid"` state the
  // button is shown in. Asserting its absence over a loaded page would pass
  // against a button that upstream had merely parked off-screen.
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    Assert.equal(
      gURLBar.getAttribute("pageproxystate"),
      "invalid",
      "this is the state the unified search button shows itself in"
    );
    const switcher = gURLBar.querySelector(".searchmode-switcher");
    Assert.ok(
      switcher,
      "the element is still there — it is upstream's, not ours"
    );
    Assert.equal(
      window.getComputedStyle(switcher).display,
      "none",
      "and it is out of the box tree, not merely invisible or parked off-screen"
    );
    Assert.equal(
      switcher.getBoundingClientRect().width,
      0,
      "so it takes no space at the leading edge of the bar"
    );
  });
});

/**
 * And it is gone for the keyboard too, which is the half that hiding usually
 * misses.
 *
 * The button hides itself with an `offscreen` attribute — `position: fixed;
 * top: -999px` — precisely so that it stays focusable while invisible, and it
 * puts itself back in the tab order on `focusin` and opens its panel on
 * ArrowDown. Copying that technique would have moved a Google logo out of
 * sight and left the whole engine list one Tab away. `display: none` is what
 * takes it out of the tab order and the accessibility tree at the same time.
 */
add_task(async function the_switcher_cannot_be_reached_by_keyboard() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    const switcher = gURLBar.querySelector(".searchmode-switcher");
    const panelList = gURLBar.querySelector(".searchmode-switcher-panel-list");
    const xulPanel = gURLBar.querySelector(".searchmode-switcher-panel");

    switcher.focus();
    Assert.notEqual(
      document.activeElement,
      switcher,
      "it refuses focus, so nothing can Tab onto it"
    );

    // The three gestures that open the engine list upstream. Each is checked
    // rather than reasoned about: the panel anchors on the button, and a panel
    // anchored to a hidden element is not obviously a panel that stays shut.
    const gestures = [
      ["KEY_ArrowDown", {}, "ArrowDown"],
      ["KEY_ArrowDown", { altKey: true }, "Alt+Down"],
      ["KEY_ArrowDown", { accelKey: true }, "Accel+Down"],
    ];
    for (const [key, modifiers, name] of gestures) {
      gURLBar.focus();
      EventUtils.synthesizeKey(key, modifiers, window);
      await TestUtils.waitForTick();
      Assert.ok(!panelList?.open, `${name} opened no engine list`);
      Assert.notEqual(xulPanel?.state, "open", `${name} opened no panel`);
      Assert.equal(
        gURLBar.searchMode,
        null,
        `${name} set no search mode on a bar that cannot be typed into`
      );
    }
    gURLBar.blur();
    bar().close();
  });
});

/**
 * The one thing this fork says about a page that loads in the background.
 *
 * The design record settled the signal's form — a persistent binary state,
 * read on the next voluntary glance — and left its surface open between the
 * Field's own affordance and the command bar's resting state. This window is
 * the answer: there is no Field affordance in the chrome, and the command bar
 * has no DOM until it is opened, so the only thing permanently on screen is
 * this bar. The test is therefore about *this* element, and it checks the
 * screen-reader half too, because a coloured dot says nothing to anyone who is
 * not looking at it.
 */
add_task(async function an_unseen_arrival_marks_the_bar() {
  const surface = FOSFieldSurface.forWindow(window);
  surface.open();
  surface.close();
  Assert.ok(
    !gURLBar.hasAttribute("fos-unseen"),
    "no mark when nothing has arrived"
  );

  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  try {
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE);
    await TestUtils.waitForCondition(
      () => gURLBar.hasAttribute("fos-unseen"),
      "a page arriving in the background marked the bar"
    );
    Assert.equal(
      gURLBar.inputField.getAttribute("aria-description"),
      "Pages have arrived in the Field since you looked",
      "and said so in words as well as in a dot"
    );
    Assert.notEqual(
      window.getComputedStyle(
        gURLBar.querySelector(".urlbar-input-container"),
        "::after"
      ).content,
      "none",
      "the mark is actually drawn"
    );

    surface.open();
    Assert.ok(!gURLBar.hasAttribute("fos-unseen"), "looking cleared the mark");
    Assert.ok(
      !gURLBar.inputField.hasAttribute("aria-description"),
      "and cleared what it said"
    );
  } finally {
    surface.close();
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function unwiring_gives_the_address_bar_back() {
  display().unwire();
  Assert.ok(!display().isWired, "unwired");
  Assert.ok(!gURLBar.readOnly, "and typable again");
  Assert.equal(
    gURLBar.inputField.getAttribute("data-l10n-id"),
    "urlbar-placeholder",
    "and Fluent owns the placeholder again"
  );
  // The switcher is hidden by a rule scoped to the attribute, so the pref that
  // gives the address bar back has to give the engine picker back with it —
  // a typable bar with no way to choose what it searches would be a worse
  // browser than either of the two this pref chooses between.
  Assert.notEqual(
    window.getComputedStyle(gURLBar.querySelector(".searchmode-switcher"))
      .display,
    "none",
    "and the search-mode switcher came back with the input it belongs to"
  );

  bar().close();
  EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);
  Assert.ok(!bar().isOpen, "a press no longer reaches the command bar");

  // Put the window back the way every other file in this directory found it:
  // they share one window, and a typable address bar left behind would be a
  // different browser for whichever file runs next.
  gURLBar.blur();
  display().wire(bar(), FOSFieldSurface.forWindow(window));
  Assert.ok(display().isWired, "re-wired for the rest of the suite");
});
