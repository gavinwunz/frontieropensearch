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
