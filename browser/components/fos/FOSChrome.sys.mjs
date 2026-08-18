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
