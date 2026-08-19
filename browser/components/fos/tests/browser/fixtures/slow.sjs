/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A page that takes its time, so a test can look at a load in flight.
 *
 * Everything about `userTypedValue` happens in the gap between asking for a
 * page and getting it, and against a local fixture that gap is a millisecond
 * or two — long enough to assert against synchronously, far too short to catch
 * the state that only exists once the load has actually started. Session store
 * records `userTypedClear` from a flag the tab progress listener raises at
 * `STATE_START`, which is after the request is issued and before the body
 * arrives; this holds the response open so that window is wide enough to read.
 *
 * The headers go out immediately and only the body is delayed, which is what
 * makes the load *start* promptly and *finish* late — a fixture that simply
 * slept before responding would delay both and leave the same gap it was meant
 * to open.
 */

/* eslint-env mozilla/sjs */

const DELAY_MS = 3000;

// Held on the scope so the timer is not collected before it fires.
let timer;

function handleRequest(request, response) {
  response.processAsync();
  response.setHeader("Cache-Control", "no-store", false);
  response.setHeader("Content-Type", "text/html;charset=utf-8", false);

  timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timer.init(
    () => {
      response.write("<!DOCTYPE html><title>Slow</title>Arrived eventually.");
      response.finish();
    },
    DELAY_MS,
    Ci.nsITimer.TYPE_ONE_SHOT
  );
}
