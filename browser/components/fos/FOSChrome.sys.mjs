/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The small things every one of this component's chrome surfaces needs.
 *
 * Each surface builds its DOM on first open rather than putting markup in
 * `browser.xhtml`, so a window that never opens one pays nothing for it. That
 * decision has one consequence they all share: the stylesheet arrives at the
 * same moment as the elements it styles.
 */

/** Windows to the sheets already loaded into them. */
const loaded = new WeakMap();

/* The design tokens every other FOS sheet is written against. */
const TOKENS = "chrome://browser/content/fos/fos-tokens.css";

/**
 * Put a stylesheet on a chrome window, synchronously, once.
 *
 * Appending a `<link>` is the obvious way and it is subtly wrong here. The
 * load is asynchronous, so the first frame after `open()` paints the panel
 * with none of its rules: a fixed-position rail 22rem wide is, for that frame,
 * a full-width block pushing the whole window around. It is a flash of
 * unstyled chrome, and it was caught by a test that opened two surfaces and
 * measured them — the second one had not been styled yet and reported the
 * width of the window.
 *
 * `loadSheetUsingURIString` loads a chrome sheet synchronously and applies it
 * before the caller gets control back, so the first frame is already correct
 * and code that measures immediately after opening measures the real thing.
 *
 * @param {Window} window A chrome window.
 * @param {string} url A `chrome://` stylesheet.
 */
export function ensureStylesheet(window, url) {
  let sheets = loaded.get(window);
  if (!sheets) {
    sheets = new Set();
    loaded.set(window, sheets);
  }
  if (sheets.has(url)) {
    return;
  }
  // The token sheet underlies every FOS surface, so it is loaded here rather
  // than `@import`ed by each of them: one place that cannot drift, and it is
  // guaranteed present whichever surface a window happens to open first.
  if (url != TOKENS) {
    ensureStylesheet(window, TOKENS);
  }
  const utils = window.windowUtils;
  utils.loadSheetUsingURIString(url, utils.AUTHOR_SHEET);
  sheets.add(url);
}

/** Windows whose toolbox is already being watched. */
const watched = new WeakSet();

/**
 * The custom property the panels read for where the chrome ends.
 *
 * Written on the document element rather than on each panel so that a surface
 * opened later inherits the current value without having to ask for it.
 */
const BLOCK_START = "--fos-chrome-block-start";

/**
 * Keep `--fos-chrome-block-start` equal to the height of the browser's own
 * toolbar area, for as long as the window lives.
 *
 * The rail and the context sidebar are `position: fixed` and were `inset-block:
 * 0`, so they ran the full height of the window and painted over the toolbox —
 * which they sit above deliberately, because the toolbox carries `z-index: 0`
 * and would otherwise paint over them. Covering the *page* is the staged
 * trade-off recorded in STATE; covering the browser's own controls was not
 * meant, and was invisible in every test because no assertion looks at what a
 * panel is on top of. In a screenshot it is immediate: with the rail open there
 * is no back button, and with the sidebar open there is no app menu.
 *
 * Measured rather than declared, because the toolbox height is not a constant:
 * the bookmarks toolbar comes and goes, the nav-bar takes the titlebar in this
 * fork because the tab strip is gone, full screen removes the toolbox
 * altogether, and a text-size change moves all of it. `bottom` rather than
 * `height` so that anything the platform puts above the toolbox is counted too.
 *
 * @param {Window} window A chrome window.
 */
export function trackChromeInset(window) {
  if (watched.has(window)) {
    return;
  }
  const toolbox = window.document.getElementById("navigator-toolbox");
  if (!toolbox) {
    return;
  }
  watched.add(window);

  let last = null;
  const apply = () => {
    // A hidden toolbox has no box at all, and a panel below nothing starts at
    // the top of the window — which is what full screen should look like.
    const px = Math.max(0, Math.round(toolbox.getBoundingClientRect().bottom));
    if (px === last) {
      return;
    }
    last = px;
    window.document.documentElement.style.setProperty(BLOCK_START, `${px}px`);
  };
  apply();

  const observer = new window.ResizeObserver(apply);
  observer.observe(toolbox);
  // Where the toolbox *ends* can move without the toolbox resizing: full screen
  // slides it out of view by margin rather than shrinking it, which no observer
  // on the toolbox alone would see. The content box below it does grow, so
  // watching that catches the same moment from the other side.
  const content = window.document.getElementById("browser");
  if (content) {
    observer.observe(content);
  }
  window.addEventListener("unload", () => observer.disconnect(), {
    once: true,
  });
}

/** Windows to the surfaces that have held their keyboard, oldest first. */
const custody = new WeakMap();

/**
 * Give a surface the keyboard, and remember that it has it.
 *
 * Every FOS surface takes focus the moment it opens, because each one owns
 * every keystroke while it is up. What none of them could answer alone is
 * where the keyboard goes when they close: each one handed it to the content
 * area, which is right when the surface was the only thing on screen and wrong
 * whenever it was not. Open the rail, open the Field, shut the rail — the
 * keyboard went to the page behind the Field, so Escape no longer zoomed out
 * and the Field's own keys did nothing, on a surface still filling the window.
 *
 * So custody is a window-level fact and it is kept here, where the other
 * things every surface shares are. A stack rather than a ranking: the surface
 * that most recently took the keyboard is the one that gets it back, which
 * needs no invented precedence between panels and is what the user just did.
 *
 * `focusVisible: true` rather than a bare focus, for the same reason at every
 * call site: a programmatic focus inherits whatever mode the window is already
 * in, so a surface opened after a click or a drag would draw no focus ring at
 * all while owning every keystroke.
 *
 * @param {Window} window A chrome window.
 * @param {object} surface The surface taking the keyboard. Must expose
 *   `isOpen`.
 * @param {Element} element The element within it to focus.
 */
export function takeFocus(window, surface, element) {
  const held = (custody.get(window) ?? []).filter(e => e.surface !== surface);
  held.push({ surface, element });
  custody.set(window, held);
  element.focus({ focusVisible: true });
}

/**
 * Hand the keyboard on after a surface closes.
 *
 * The next surface down that is still open gets it; if there is none, the
 * content area does, which is the only honest answer while there is no tab
 * strip to return to.
 *
 * Surfaces are asked `isOpen` rather than trusted to have released, because
 * closing is not the only way a surface stops being on screen and a stale
 * entry must not be able to swallow the keyboard.
 *
 * @param {Window} window A chrome window.
 * @param {object} surface The surface that has just closed.
 * @param {object} [options]
 * @param {boolean} [options.toPage] Skip the stack and go to the content
 *   area. For a surface that closed *because* it put a new page in front of
 *   the user: the stack answers "what was on screen before this", and after a
 *   navigation that is the wrong question.
 */
export function releaseFocus(window, surface, { toPage = false } = {}) {
  const held = (custody.get(window) ?? []).filter(e => e.surface !== surface);
  custody.set(window, held);
  if (!toPage) {
    for (let i = held.length - 1; i >= 0; i--) {
      if (held[i].surface.isOpen) {
        held[i].element.focus({ focusVisible: true });
        return;
      }
    }
  }
  window.gBrowser?.selectedBrowser?.focus();
}
