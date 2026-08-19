/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The clearing dialogs say what they will take out of the Context Engine.
 *
 * The sentence itself is settled in `tests/node/test_forgetpreview.mjs` and
 * the numbers in `tests/unit/test_contextstore.js`; neither is repeated here.
 * What only a real dialog can show is the wiring, which is where this fork's
 * defects have consistently been: that the element exists in the groupbox
 * that survives `init()`, that the selected timespan reaches the store as the
 * range it means, and that a clear which is not going to touch the engine
 * says nothing about it.
 *
 * Nothing here accepts a dialog. Every file in this directory shares one
 * profile database, and accepting either of these would clear it out from
 * under the files that run after.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);

/** A host no other file in this directory records anything against. */
const PREVIEW_HOST = "preview-me.invalid";

const SANITIZE_URL = "chrome://browser/content/sanitize_v2.xhtml";
const CLEAR_SITE_URL = "chrome://browser/content/places/clearDataForSite.xhtml";

/**
 * Open a clearing dialog the way the browser opens it.
 *
 * Both of these are sub-dialogs of the browser window rather than windows of
 * their own, and opening one standalone is not a shortcut to the same thing:
 * `resizeDialog` is put on the window by the sub-dialog frame, and without it
 * the shipped `init()` throws partway through. So this goes through
 * `Sanitizer.showUI` and `gDialogBox` — the callers `browser-sets.js` and the
 * Places controller use — and never awaits the returned promise before the
 * dialog has been dismissed, because it resolves on dismissal.
 *
 * @param {string} url
 * @param {Function} invoke Opens the dialog; its promise resolves on close.
 * @returns {Promise<{win: Window, closed: Promise}>}
 */
async function openDialog(url, invoke) {
  const opened = BrowserTestUtils.promiseAlertDialogOpen(null, url, {
    isSubDialog: true,
  });
  const closed = invoke();
  const win = await opened;
  await BrowserTestUtils.waitForEvent(win, "load");
  return { win, closed };
}

/**
 * Dismiss a dialog and wait for its opener to notice.
 *
 * Cancel, never accept: every file in this directory shares one profile
 * database, and accepting either of these would clear it out from under the
 * files that run after.
 *
 * @param {{win: Window, closed: Promise}} dialog
 * @returns {Promise<void>}
 */
async function cancel(dialog) {
  dialog.win.document.querySelector("dialog").cancelDialog();
  await dialog.closed;
}

/**
 * The preview line once it has settled, or null if it stayed empty.
 *
 * Neither dialog awaits its preview — a database read must not hold up the
 * first paint — so the element is the thing to wait on, not the load.
 *
 * @param {Window} win
 * @returns {Promise<?string>}
 */
async function previewText(win) {
  const el = win.document.getElementById("fosForgetPreview");
  Assert.ok(el, "the dialog has a line to put this on");
  try {
    await TestUtils.waitForCondition(
      () => !el.hidden && el.textContent,
      "the preview line fills in"
    );
  } catch (e) {
    return null;
  }
  return el.textContent;
}

/**
 * The page count the sentence reports.
 *
 * Read by stripping the separators rather than by matching them: the grouping
 * character is a comma in one locale and a narrow no-break space in another,
 * and this test is not about which. Pages are the first item the sentence
 * lists, so nothing but the lead-in stands before them.
 *
 * @param {string} text
 * @returns {number}
 */
function pagesIn(text) {
  const at = text.search(/ pages?\b/);
  Assert.greater(at, 0, `"${text}" names a number of pages`);
  return Number(text.slice(0, at).replace(/\D/g, ""));
}

add_setup(async function () {
  const store = await FOSContextEngine.store();
  const trailId = await store.addTrail({ name: "a trail to preview" });
  await store.addNode({ trailId, url: `https://${PREVIEW_HOST}/page` });
});

add_task(async function test_the_clear_dialog_previews_the_selected_range() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.sanitize.timeSpan", Sanitizer.TIMESPAN_HOUR],
      ["privacy.clearHistory.browsingHistoryAndDownloads", true],
    ],
  });
  const dialog = await openDialog(SANITIZE_URL, () => Sanitizer.showUI(window));

  const hour = await previewText(dialog.win);
  Assert.ok(
    hour,
    "clearing the last hour says what it will take, and the page written in " +
      "`add_setup` is inside that hour — a dialog handing the store the " +
      "service's microseconds unconverted would be asking about the year " +
      "55000 and would have nothing at all to report"
  );
  const hourPages = pagesIn(hour);
  Assert.greater(hourPages, 0, "and it found the pages recorded this hour");
  Assert.stringContains(
    hour,
    "out of your Context Engine",
    "phrased as a partial clear"
  );

  dialog.win.document.getElementById("sanitizeDurationChoice").value =
    Sanitizer.TIMESPAN_EVERYTHING;
  await dialog.win.gSanitizePromptDialog.selectByTimespan();
  const everything = await previewText(dialog.win);
  Assert.ok(everything, "and so does clearing everything");
  Assert.greaterOrEqual(
    pagesIn(everything),
    hourPages,
    "everything is at least the last hour — the line follows the menulist " +
      "rather than being computed once when the dialog opened"
  );
  Assert.stringContains(
    everything,
    "empties your Context Engine",
    "and says the stronger thing, because that is the stronger delete"
  );

  await cancel(dialog);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_no_preview_when_history_is_not_being_cleared() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.sanitize.timeSpan", Sanitizer.TIMESPAN_EVERYTHING],
      ["privacy.clearHistory.browsingHistoryAndDownloads", false],
    ],
  });
  const dialog = await openDialog(SANITIZE_URL, () => Sanitizer.showUI(window));

  const el = dialog.win.document.getElementById("fosForgetPreview");
  // The store is read asynchronously, so a preview that ignored the checkbox
  // would fill this in a moment from now rather than immediately. Settling the
  // one that would have been in flight is what makes the assertion mean
  // something.
  await dialog.win.gSanitizePromptDialog.updateForgetPreview();
  Assert.ok(
    el.hidden && !el.textContent,
    "the Context Engine is cleared under CLEAR_HISTORY, so with that box " +
      "clear nothing here is touched, and describing a delete that is not " +
      "going to happen is worse than saying nothing"
  );

  const checkbox = dialog.win.document.getElementById(
    "browsingHistoryAndDownloads"
  );
  EventUtils.synthesizeMouseAtCenter(checkbox, {}, dialog.win);
  Assert.ok(
    await previewText(dialog.win),
    "and ticking it brings the line back through the dialog's own pref sync, " +
      "so the line tracks the choice rather than the state it opened in"
  );

  await cancel(dialog);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_forget_about_this_site_previews_the_site() {
  const dialog = await openDialog(CLEAR_SITE_URL, () =>
    window.gDialogBox.open(CLEAR_SITE_URL, {
      host: PREVIEW_HOST,
      hostOrBaseDomain: PREVIEW_HOST,
    })
  );

  const text = await previewText(dialog.win);
  Assert.ok(
    text,
    "forgetting a site says what goes with it — the case where the blast " +
      "radius is least guessable, because the pages come out of the middle " +
      "of trails that are mostly about other sites"
  );
  Assert.greater(pagesIn(text), 0, "and the fixture host is counted");
  Assert.stringContains(
    text,
    "out of your Context Engine",
    "phrased as a partial clear, not as emptying the engine"
  );

  await cancel(dialog);
});
