/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The address bar, reduced to displaying the address.
 *
 * The command bar is meant to be the one place text is entered — search, URL,
 * commands, trail-jump and context-switch all go through one grammar — and
 * until now that was true of the keyboard only. `accel+L` and its friends were
 * taken four runs ago, but the address bar was still sitting there, still
 * focusable with a click, and still the obvious thing a mouse reaches for. So
 * the fork had two entry surfaces and claimed one.
 *
 * The tempting fix is to delete it. That would be a mistake, and there is a
 * fork that made it: Zen shipped an origin-spoofing advisory
 * (GHSA-vjfv-85qf-v25c) whose root cause was chrome that hid where the user
 * actually was. Origin visibility is a security boundary, not decoration, and
 * everything that makes Firefox's display of it trustworthy — the eTLD+1
 * emphasis, punycode handling for lookalike domains, mixed-content and
 * certificate state, the permissions the site holds — lives in this element
 * and in fifteen years of work behind it. Re-implementing that inside a
 * command bar would be re-earning it, badly.
 *
 * So the bar is split along the seam it already has. Entry moves to the
 * command bar; display stays exactly where it is, with all of its machinery
 * intact. `readOnly` is the supported way to do that and not an invention
 * here: popup windows and taskbar tabs have shipped an address bar that shows
 * an origin and cannot be typed into for years, which is why every anchor,
 * every panel and every identity surface keeps working.
 *
 * What is new is where the click goes. A read-only address bar that swallows
 * clicks would be worse than one you can type in — it would look like an input
 * and do nothing. Clicking anywhere in it that is not an identity or page
 * control opens the command bar, empty, which is where the user was going.
 * That makes the command bar reachable by mouse in the same one gesture the
 * keyboard has, and it is the last thing the single-surface claim was waiting
 * on.
 */

import { ensureStylesheet } from "./FOSChrome.sys.mjs";

const byWindow = new WeakMap();

const STYLESHEET = "chrome://browser/content/fos/fos-locationdisplay.css";

/** The pref that governs this. False restores a typable address bar. */
const PREF = "browser.fos.commandBar.replacesAddressBar";

/**
 * What an empty address bar says now.
 *
 * Upstream's is "Search or enter address", which is an instruction to type
 * here — and this bar refuses typing. A control that advertises something it
 * will not do is the same defect as the I-beam the stylesheet removed, one
 * layer up, and it is the first thing a new window shows: the placeholder is
 * only visible when there is no address, which is exactly the blank tab a
 * first run opens on.
 *
 * So it describes what a press does rather than what a keystroke would. Not
 * "the command bar" by name, because a surface a user has not met yet cannot
 * be referred to by name in the sentence that introduces it.
 */
const PLACEHOLDER = "Press to search or run a command";

/**
 * Elements inside the address bar that keep their own click.
 *
 * Each is a control with a job of its own, and each of those jobs is the
 * reason the element was kept rather than deleted: the identity box opens the
 * site-information panel, which is the anti-spoofing surface this whole module
 * exists to preserve, and the page actions are the bookmark star and its
 * neighbours. Handing their clicks to the command bar would preserve the
 * display and then make it unusable.
 *
 * The search-mode switcher is deliberately **not** here, and the entry that
 * used to claim it was is worth a warning. It read
 * `"#urlbar-searchmode-switcher"`, and that id does not exist: the element is
 * `moz-button.searchmode-switcher`, with no id at all. So the list said the
 * switcher kept its own press and it never did — every press already reached
 * the command bar, and the single-entry-surface claim was true of the mouse by
 * accident. Correcting the selector rather than deleting the line would have
 * been the natural-looking change and would have built the second entry
 * surface this module exists to remove. The switcher is hidden outright now;
 * `fos-locationdisplay.css` carries the reasoning.
 *
 * `.urlbar-go-button` was dead the same way and for the same reason: the
 * address bar became a custom element shared with the search bar, so what were
 * ids on a singleton are classes on a reusable one. A selector here that
 * matches nothing fails silently and in the safe-looking direction — the
 * control simply loses its press — so the list is checked against a real
 * window by `browser_locationdisplay.js` rather than trusted by reading.
 */
export const PASSTHROUGH = [
  "#identity-box",
  "#trust-icon-container",
  "#tracking-protection-icon-container",
  "#page-action-buttons",
  ".urlbar-go-button",
  "#urlbar-revert-button-container",
  "#remote-control-box",
];

/**
 * The address bar of one window, retired as an input.
 */
export class FOSLocationDisplay {
  /**
   * The display for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSLocationDisplay}
   */
  static forWindow(window) {
    let display = byWindow.get(window);
    if (!display) {
      display = new FOSLocationDisplay(window);
      byWindow.set(window, display);
    }
    return display;
  }

  #window;
  #bar = null;
  #urlbar = null;
  #onMouseDown = null;
  #wired = false;
  #setPlaceholder = null;

  constructor(window) {
    this.#window = window;
  }

  /** Whether this window's address bar has been retired. Tests read this. */
  get isWired() {
    return this.#wired;
  }

  /**
   * Retire this window's address bar in favour of the command bar.
   *
   * A window whose address bar is already read-only for a reason of its own —
   * a popup, or a taskbar tab — is left alone. It has no command bar worth
   * opening and Firefox has already made the same decision for it.
   *
   * @param {object} bar The window's `FOSCommandBar`.
   * @returns {FOSLocationDisplay} This, for chaining.
   */
  wire(bar) {
    this.#bar = bar;
    if (this.#wired || !Services.prefs.getBoolPref(PREF, true)) {
      return this;
    }
    const urlbar = this.#window.gURLBar;
    if (!urlbar || urlbar.readOnly) {
      return this;
    }
    this.#urlbar = urlbar;
    urlbar.readOnly = true;
    // `readOnly` refuses typing and changes nothing about what the element
    // looks like, so on its own it leaves an I-beam over a field that will not
    // take a caret. The attribute is what the stylesheet hangs on.
    urlbar.setAttribute("fos-location-display", "true");
    ensureStylesheet(this.#window, STYLESHEET);

    // Not simply written onto the element: the placeholder is Fluent's, and
    // the search service sets it again — with the default engine's name in it
    // — some time after a window is built, so anything written at wiring time
    // is overwritten a moment later by a string that reads "Search with
    // <engine> or enter address". Found by a test, having looked right in the
    // window that produced it.
    //
    // So the override goes on the one method that owns the decision, and every
    // later caller lands on ours. `_setPlaceholder` is internal to
    // `UrlbarInputBase`, which is exactly why this is the right seam for a
    // fork: the element has been given a new job, and this is the method that
    // states the old one.
    this.#setPlaceholder = urlbar._setPlaceholder.bind(urlbar);
    urlbar._setPlaceholder = () => {
      const input = urlbar.inputField;
      if (!input) {
        return;
      }
      input.removeAttribute("data-l10n-id");
      input.removeAttribute("data-l10n-args");
      input.setAttribute("placeholder", PLACEHOLDER);
    };
    urlbar._setPlaceholder();

    // Capture, because the input inside would otherwise take the click first
    // and put a caret in text the user cannot edit. `mousedown` rather than
    // `click`, for the same reason and one better: focus moves on mousedown,
    // so waiting for the click means a visible flicker of the address bar
    // taking focus before the command bar takes it away.
    this.#onMouseDown = event => this.#handle(event);
    urlbar.addEventListener("mousedown", this.#onMouseDown, { capture: true });
    this.#wired = true;
    return this;
  }

  /** Give the address bar back, for a test or for the pref going false. */
  unwire() {
    if (!this.#wired) {
      return;
    }
    this.#urlbar.removeEventListener("mousedown", this.#onMouseDown, {
      capture: true,
    });
    this.#urlbar.readOnly = false;
    this.#urlbar.removeAttribute("fos-location-display");
    if (this.#setPlaceholder) {
      delete this.#urlbar._setPlaceholder;
      this.#urlbar.inputField?.removeAttribute("placeholder");
      // Null rather than the engine name: the name is the search service's to
      // know, and it re-states it on the next engine change anyway.
      this.#urlbar._setPlaceholder(null);
      this.#setPlaceholder = null;
    }
    this.#onMouseDown = null;
    this.#wired = false;
  }

  /**
   * Decide what one press inside the address bar means.
   *
   * @param {MouseEvent} event The press.
   */
  #handle(event) {
    // Only the primary button. A right-click is the context menu, which still
    // offers copy — reading the URL out of the browser is not something this
    // change should take away.
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target?.closest &&
      PASSTHROUGH.some(selector => target.closest(selector))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#bar.open();
  }
}
