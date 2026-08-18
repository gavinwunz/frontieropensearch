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
const { FOSLocationDisplay } = ChromeUtils.importESModule(
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

add_task(async function unwiring_gives_the_address_bar_back() {
  display().unwire();
  Assert.ok(!display().isWired, "unwired");
  Assert.ok(!gURLBar.readOnly, "and typable again");
  Assert.equal(
    gURLBar.inputField.getAttribute("data-l10n-id"),
    "urlbar-placeholder",
    "and Fluent owns the placeholder again"
  );

  bar().close();
  EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);
  Assert.ok(!bar().isOpen, "a press no longer reaches the command bar");

  // Put the window back the way every other file in this directory found it:
  // they share one window, and a typable address bar left behind would be a
  // different browser for whichever file runs next.
  gURLBar.blur();
  display().wire(bar());
  Assert.ok(display().isWired, "re-wired for the rest of the suite");
});
