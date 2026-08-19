/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The `model` verb: the one place this fork asks to fetch something.
 *
 * `browser_zzrelated.js` proves the tier works once the weights are here, and
 * needs real weights to do it. This file is the other half and deliberately
 * needs none: what it covers is the *surfacing* — that the user is told the
 * size and the host before bytes move, that progress is reported, and above
 * all that a fetch which failed does not leave consent recorded behind it.
 *
 * That last one is the reason this file exists. The pref means "the weights
 * are here and wanted"; if a failed download set it anyway, the next session's
 * first keystroke into the command bar would quietly make the request the
 * whole design is arranged to prevent. It is invisible in every other test,
 * because every other test is about a browser where the fetch worked.
 *
 * The seam is `FOSEmbeddings._open`, which is the single call that talks to
 * the ML runtime. Everything above it — the pref, the in-flight flag, the
 * sentences — is the real code.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSEmbeddings } = ChromeUtils.importESModule(
  "resource:///modules/FOSEmbeddings.sys.mjs"
);

const PREF = "browser.fos.suggest.semanticTier";

function bar() {
  return FOSCommandBar.forWindow(window);
}

/** Run the verb the way the parser would hand it over. */
function runModel() {
  return bar().actions.run({ action: "model", target: null, text: null })
    .result;
}

/**
 * Collect every sentence the bar says.
 *
 * The notice line holds one message at a time, so reading the DOM after the
 * fact would only ever show the last one — and the claim under test is about
 * the order, which is where the disclosure lives.
 *
 * @returns {string[]} Filled as the run proceeds.
 */
function recordNotices() {
  const target = bar();
  const said = [];
  const original = target.notify.bind(target);
  target.notify = message => {
    said.push(message);
    original(message);
  };
  registerCleanupFunction(() => delete target.notify);
  return said;
}

/**
 * Stand in for the one call that reaches the ML runtime.
 *
 * Faithful to the contract `_open` has with the rest of the module rather than
 * to its body: it resolves to an engine or to null, it sets `_engine` and
 * `_unavailable` the same way, and it clears `_loading` in a `finally` so that
 * a caller arriving mid-flight joins rather than starting a second fetch.
 *
 * @param {object} options
 * @param {boolean} [options.fail] Resolve to null, as a missing model does.
 * @param {number[]} [options.loaded] Cumulative byte counts to report.
 * @param {?Promise} [options.until] Held open until this resolves.
 * @returns {object} `{calls}`, counting how often the runtime was reached.
 */
function stubOpen({ fail = false, loaded = [], until = null } = {}) {
  const state = { calls: 0 };
  FOSEmbeddings._open = function (onProgress) {
    state.calls++;
    return (async () => {
      for (const totalLoaded of loaded) {
        // Shaped like the runtime's own report: `progress` is a per-file
        // percentage that restarts, `totalLoaded` is the running total. The
        // double carries both so that reading the wrong one still fails here.
        onProgress?.({ progress: 100, totalLoaded });
      }
      if (until) {
        await until;
      }
      if (fail) {
        this._unavailable = true;
        return null;
      }
      this._engine = { terminate: async () => {} };
      return this._engine;
    })().finally(() => {
      this._loading = null;
    });
  };
  return state;
}

/** @param {boolean} answer Whether the weights are already on disk. */
function stubPresent(answer) {
  FOSEmbeddings.present = async () => answer;
}

const REAL_OPEN = FOSEmbeddings._open;
const REAL_PRESENT = FOSEmbeddings.present;

add_setup(async function () {
  // The bar has to exist before its notices can be intercepted, and the engine
  // has to be attached before the verb it registers is bound.
  FOSContextEngine.forWindow(window);
  registerCleanupFunction(async () => {
    FOSEmbeddings._open = REAL_OPEN;
    FOSEmbeddings.present = REAL_PRESENT;
    await FOSEmbeddings.shutdown();
    Services.prefs.clearUserPref(PREF);
  });
});

/** Put the module and the pref back to how an untouched profile finds them. */
async function reset() {
  FOSEmbeddings._open = REAL_OPEN;
  FOSEmbeddings.present = REAL_PRESENT;
  await FOSEmbeddings.shutdown();
  Services.prefs.clearUserPref(PREF);
}

add_task(async function test_the_first_line_says_the_size_and_the_host() {
  await reset();
  stubPresent(false);
  const opened = stubOpen({ loaded: [4.2e6, 4.9e6, 26e6] });
  const said = recordNotices();

  Assert.ok(!Services.prefs.getBoolPref(PREF), "the tier starts off");
  Assert.ok(await runModel(), "the verb reports the tier on");

  Assert.greaterOrEqual(said.length, 3, `said: ${said.join(" | ")}`);
  Assert.ok(
    said[0].includes(`about ${FOSEmbeddings.weightsMB}MB`),
    `the first line gives the size: ${said[0]}`
  );
  Assert.ok(said[0].includes("once"), "and says it happens once");
  Assert.ok(
    said[0].includes(FOSEmbeddings.hubHost),
    `and names the host it contacts: ${said[0]}`
  );

  const moved = said.filter(line => /MB of about/.test(line));
  Assert.equal(
    moved.length,
    2,
    `two of the three reports moved the number: ${moved.join(" | ")}`
  );
  Assert.ok(moved[0].includes("4MB of about"), "the running total is reported");
  Assert.ok(
    moved[1].includes("26MB of about"),
    "and it counts up rather than restarting per file"
  );

  Assert.ok(/ready/.test(said.at(-1)), `and it ends: ${said.at(-1)}`);
  Assert.equal(opened.calls, 1, "the runtime was reached once");
  Assert.ok(
    Services.prefs.getBoolPref(PREF),
    "consent is recorded now that the weights are here"
  );
});

add_task(async function test_a_failed_download_records_no_consent() {
  await reset();
  stubPresent(false);
  stubOpen({ fail: true });
  const said = recordNotices();

  Assert.ok(!(await runModel()), "the verb reports the tier still off");
  Assert.ok(
    /could not be downloaded/.test(said.at(-1)),
    `and says so: ${said.at(-1)}`
  );
  // The whole point. A pref set on the way in would have armed the next
  // session to make this request without being asked again.
  Assert.ok(
    !Services.prefs.getBoolPref(PREF),
    "and a fetch that failed leaves the tier switched off"
  );
});

add_task(async function test_weights_already_here_are_not_fetched_again() {
  await reset();
  stubPresent(true);
  const opened = stubOpen({});
  Services.prefs.setBoolPref(PREF, true);
  const said = recordNotices();

  Assert.ok(await runModel(), "the tier is on");
  Assert.equal(
    said.length,
    1,
    `one sentence, not a download: ${said.join(" | ")}`
  );
  Assert.ok(/already here/.test(said[0]), `which says why: ${said[0]}`);
  Assert.equal(opened.calls, 0, "and the runtime was never reached");
});

add_task(async function test_weights_here_but_the_tier_off_says_no_download() {
  await reset();
  stubPresent(true);
  stubOpen({});
  const said = recordNotices();

  // A profile that downloaded the model and later had the pref reset. Loading
  // from the cache is not a transfer, so claiming one would be a lie — and the
  // kind a user checking whether this fork phones home would catch.
  Assert.ok(await runModel(), "the tier comes back on");
  Assert.ok(
    !said.some(line => /Downloading/.test(line)),
    `nothing claims to be downloading: ${said.join(" | ")}`
  );
  Assert.ok(/ready/.test(said.at(-1)), `and it reports ready: ${said.at(-1)}`);
  Assert.ok(Services.prefs.getBoolPref(PREF), "with consent recorded");
});

add_task(async function test_deleted_weights_are_not_silently_refetched() {
  await reset();
  // Consent given in some earlier session...
  Services.prefs.setBoolPref(PREF, true);
  // ...and the user has since cleared the model cache to get the 30MB back.
  stubPresent(false);
  const opened = stubOpen({});

  // The Chrome failure this is here to not repeat: a model deleted from disk
  // and quietly downloaded again, because a flag set months ago was treated as
  // permission for a transfer happening now. `IDEAS.md` run 38.
  Assert.equal(await FOSEmbeddings.ensure(), null, "the tier gets no engine");
  Assert.equal(
    opened.calls,
    0,
    "and nothing reached the runtime, so nothing was fetched"
  );
  Assert.equal(
    await FOSEmbeddings.embed(["a title"]),
    null,
    "so a keystroke gets no vectors and the tier is simply absent"
  );
  Assert.ok(
    Services.prefs.getBoolPref(PREF),
    "the pref is left alone — the user's answer was never the problem"
  );
});

add_task(async function test_weights_that_are_here_still_load_on_a_keystroke() {
  await reset();
  Services.prefs.setBoolPref(PREF, true);
  stubPresent(true);
  const opened = stubOpen({});

  // The other half of the gate above: a presence check that answered "no" to
  // everything would switch the tier off for good and pass the test before it.
  Assert.ok(await FOSEmbeddings.ensure(), "the engine loads from the cache");
  Assert.equal(opened.calls, 1, "reaching the runtime once");
  Assert.ok(await FOSEmbeddings.ensure(), "and is kept for the next keystroke");
  Assert.equal(opened.calls, 1, "without a second load");
});

add_task(async function test_a_second_run_joins_the_one_in_flight() {
  await reset();
  stubPresent(false);
  let release;
  const until = new Promise(resolve => (release = resolve));
  const opened = stubOpen({ until });
  const said = recordNotices();

  const first = runModel();
  // Let the handler reach `download` and raise the in-flight flag.
  await TestUtils.waitForCondition(
    () => FOSEmbeddings.downloading,
    "the download is in flight"
  );

  Assert.ok(!(await runModel()), "a second run does not claim success");
  Assert.ok(
    /already downloading/.test(said.at(-1)),
    `it says what is happening instead: ${said.at(-1)}`
  );

  release();
  Assert.ok(await first, "and the first run finishes");
  Assert.equal(opened.calls, 1, "one fetch, not two");
});
