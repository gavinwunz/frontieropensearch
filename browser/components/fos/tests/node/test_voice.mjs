/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the voice front end: the input adapter and the push-to-talk
 * turn. Between them these are every decision the voice path makes that is not
 * "call the model", which is why there is no microphone anywhere in this file.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY,
  HALLUCINATION,
  MARKER,
  MIN_PEAK,
  MIN_RMS,
  MIN_UTTERANCE_MS,
  SPEECH,
  TOO_QUIET,
  TOO_SHORT,
  audioIsSpeech,
  normaliseTranscript,
} from "../../FOSVoiceTranscript.sys.mjs";

import {
  ARMING,
  ARMING_DEADLINE_MS,
  END_SILENCE_DEADLINE_MS,
  IDLE,
  INITIAL_SILENCE_DEADLINE_MS,
  LISTENING,
  LISTENING_DEADLINE_MS,
  NOTICE_NOTHING_HEARD,
  NOTICE_TOO_QUIET,
  NOTICE_TOO_SHORT,
  NOTICE_UNAVAILABLE,
  TAP_MS,
  TRANSCRIBING,
  TRANSCRIBING_DEADLINE_MS,
  VoiceSession,
} from "../../FOSVoiceSession.sys.mjs";

/**
 * A clock a test can move by hand.
 *
 * The session reads one only to keep the silence bounds inside the model's
 * listening window, and that subtraction is the thing most worth testing about
 * them — so it has to be possible to be 29 seconds into a turn without having
 * waited 29 seconds.
 *
 * @param {number} [start]
 */
function clock(start = 0) {
  const c = { at: start };
  c.now = () => c.at;
  c.tick = ms => (c.at += ms);
  return c;
}

/**
 * A recording of `ms` milliseconds whose samples alternate about zero at
 * `amplitude`, which makes its RMS and its peak both `amplitude` and so lets a
 * test name the one number it means to be testing.
 *
 * @param {number} ms
 * @param {number} amplitude
 * @param {number} [sampleRate]
 */
function recording(ms, amplitude, sampleRate = 16000) {
  const count = Math.round((ms / 1000) * sampleRate);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = i % 2 ? amplitude : -amplitude;
  }
  return { samples, sampleRate };
}

/** @param {string} text */
function speech(text) {
  const result = normaliseTranscript(text);
  assert.equal(result.type, SPEECH, `expected speech from ${text}`);
  return result.text;
}

test("a transcript becomes the line the keyboard would have produced", () => {
  // Whisper's output is prose: a leading space, a capital, a full stop.
  assert.equal(speech(" Enter Cap."), "enter cap");
  assert.equal(speech("Field."), "field");
  assert.equal(
    speech(" Enter Cap, branch, name Gecko."),
    "enter cap branch name gecko"
  );
  assert.equal(speech("  spread   out   "), "spread out");
});

test("free text survives the pass intact, because it is terminal", () => {
  // GRAMMAR.md §6: `name` and `search` take the rest of the utterance
  // verbatim, so normalisation may not touch the words themselves.
  assert.equal(
    speech("Name it Bret Victor's talks."),
    "name it bret victor's talks"
  );
  assert.equal(
    speech("Search for well-known unknowns"),
    "search for well-known unknowns"
  );
  assert.equal(speech("What is the memex?"), "what is the memex");
});

test("bracketed annotations are cut, and an utterance of nothing but them is refused", () => {
  assert.equal(speech("[cough] enter cap"), "enter cap");
  assert.equal(speech("Enter cap (pause) branch"), "enter cap branch");
  for (const marker of [
    " [BLANK_AUDIO]",
    "(silence)",
    "[Music]",
    "*sniffs*",
    "♪♪♪",
  ]) {
    assert.equal(normaliseTranscript(marker).type, MARKER, marker);
  }
});

test("silence artifacts are refused as whole utterances and only as whole utterances", () => {
  for (const phrase of [" Thank you.", "you", "Thanks for watching!", "Bye."]) {
    assert.equal(normaliseTranscript(phrase).type, HALLUCINATION, phrase);
  }
  // The same words inside a real query are a real query.
  assert.equal(
    speech("thank you notes for a wedding"),
    "thank you notes for a wedding"
  );
  assert.equal(
    speech("thanks for watching the detectives"),
    "thanks for watching the detectives"
  );
});

test("nothing at all is empty rather than a crash", () => {
  for (const input of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(normaliseTranscript(input).type, EMPTY);
  }
  assert.equal(normaliseTranscript(" ... ").type, EMPTY);
});

test("a refused transcript never carries text, so a caller cannot use one by accident", () => {
  for (const input of ["", "[BLANK_AUDIO]", "Thank you."]) {
    assert.equal(normaliseTranscript(input).text, "");
  }
});

test("audio too short to be a word is never sent to the model", () => {
  const verdict = audioIsSpeech(recording(MIN_UTTERANCE_MS - 50, 0.1));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, TOO_SHORT);
  // One alphabet word said at speed is about 300ms, and must get through.
  assert.equal(audioIsSpeech(recording(300, 0.1)).ok, true);
});

test("room tone is never sent to the model, however long it runs", () => {
  const verdict = audioIsSpeech(recording(3000, MIN_RMS / 2));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, TOO_QUIET);
});

test("a steady tone is refused even though it clears the loudness floor", () => {
  // A drone: loud enough over its length to pass the RMS gate, but it never
  // peaks, which is the one thing speech always does.
  const drone = recording(1000, MIN_PEAK / 2);
  const verdict = audioIsSpeech(drone);
  assert.ok(
    verdict.rms > MIN_RMS,
    "the loudness floor alone would have let it through"
  );
  assert.ok(verdict.peak < MIN_PEAK, "and its shape is what refuses it");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, TOO_QUIET);
});

test("quiet speech gets through, because the gates are shape and not just level", () => {
  // Half the RMS of ordinary speech, with speech's own crest factor: peaks well
  // clear of the average. This is the utterance the gates must not refuse.
  const { samples, sampleRate } = recording(600, 0.006);
  for (let i = 0; i < samples.length; i += 40) {
    samples[i] = samples[i] < 0 ? -0.05 : 0.05;
  }
  const verdict = audioIsSpeech({ samples, sampleRate });
  assert.equal(
    verdict.ok,
    true,
    `refused at rms ${verdict.rms} peak ${verdict.peak}`
  );
});

test("the measurements come back even when the verdict is a refusal", () => {
  const verdict = audioIsSpeech(recording(1000, 0.001));
  assert.equal(verdict.ok, false);
  assert.ok(Math.abs(verdict.durationMs - 1000) < 1);
  assert.ok(Math.abs(verdict.rms - 0.001) < 1e-6);
  assert.ok(Math.abs(verdict.peak - 0.001) < 1e-6);
});

test("a recording with no samples is refused rather than dividing by zero", () => {
  const verdict = audioIsSpeech({
    samples: new Float32Array(0),
    sampleRate: 16000,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, TOO_SHORT);
  assert.equal(verdict.rms, 0);
  assert.equal(audioIsSpeech().ok, false);
  assert.equal(
    audioIsSpeech({ samples: new Float32Array(16000), sampleRate: 0 }).reason,
    TOO_SHORT
  );
});

test("a whole turn runs the line it heard", () => {
  const session = new VoiceSession();
  assert.equal(session.state, IDLE);
  assert.equal(session.active, false);

  assert.equal(session.press({ text: "" }).capture, "start");
  assert.equal(session.state, ARMING);

  session.armed();
  assert.equal(session.state, LISTENING);

  const partial = session.partial(" Enter");
  assert.equal(partial.input, "enter");
  assert.equal(partial.run, null, "a partial never executes");
  assert.equal(session.echo, "enter");

  assert.equal(session.release().capture, "stop");
  assert.equal(session.state, TRANSCRIBING);

  const done = session.final(" Enter Cap.");
  assert.equal(done.run, "enter cap");
  assert.equal(done.input, "enter cap");
  assert.equal(done.notice, null);
  assert.equal(session.state, IDLE);
  assert.equal(session.echo, "");
});

test("auto-repeat cannot restart a turn, which is what makes holding a key the gesture", () => {
  const session = new VoiceSession();
  session.press({ text: "half typed" });
  session.armed();
  session.partial("enter cap");

  const repeat = session.press({ text: "something else" });
  assert.equal(repeat.capture, null);
  assert.equal(repeat.input, null);
  assert.equal(session.state, LISTENING);
  assert.equal(session.echo, "enter cap", "the echo survived the repeat");
  assert.equal(session.restoreText, "half typed", "and so did the snapshot");
});

/*
 * The latch. A second gesture on the same turn, not a second mode — so what
 * these check is mostly that everything else is unchanged by it.
 */

test("a latched turn survives the key coming up, and the next press ends it", () => {
  const session = new VoiceSession();
  session.press({ text: "half typed", latch: true });
  assert.equal(session.latched, true);
  session.armed();

  const up = session.release();
  assert.equal(up.capture, null, "the key coming up does not close the device");
  assert.equal(up.deadline, null, "and does not restart the clock");
  assert.equal(session.state, LISTENING, "the turn is still listening");

  const ended = session.press({ text: "half typed" });
  assert.equal(ended.capture, "stop", "the next press closes it");
  assert.equal(session.state, TRANSCRIBING);
  assert.equal(session.final(" Enter cap.").run, "enter cap", "and it runs");
  assert.equal(session.latched, false, "the latch does not outlive the turn");
});

test("any press ends a latched turn, not only a latching one", () => {
  // Ending a turn early costs one utterance; failing to end one leaves a
  // microphone open that nothing in the platform will draw an indicator for.
  // So the press that stops is forgiving about the modifier that the press
  // which started was not.
  for (const latch of [false, true]) {
    const session = new VoiceSession();
    session.press({ text: "", latch: true });
    session.armed();
    const ended = session.press({ text: "", latch });
    assert.equal(ended.capture, "stop", `a press with latch=${latch} stops it`);
    assert.equal(session.state, TRANSCRIBING);
  }
});

test("a held turn is not latched by a press that carries the modifier", () => {
  const session = new VoiceSession();
  session.press({ text: "kept" });
  session.armed();

  const again = session.press({ text: "kept", latch: true });
  assert.equal(again.capture, null, "a press during a held turn is ignored");
  assert.equal(session.latched, false, "and cannot latch it mid-utterance");
  assert.equal(session.release().capture, "stop", "the key still ends it");
});

test("a latched turn stopped before the microphone opened complains about nothing", () => {
  const session = new VoiceSession();
  session.press({ text: "memex", latch: true });
  assert.equal(session.state, ARMING);

  const ended = session.press({ text: "memex" });
  assert.equal(ended.state, IDLE, "the turn is over");
  assert.equal(ended.capture, "stop", "and the device is closed");
  assert.equal(ended.notice, null, "with nothing to tell the user");
  assert.equal(ended.input, "memex", "and the line comes back");

  // The same stage reached by the same event on a held turn *is* a mistake —
  // the key came up before it could hear anything — and still says so.
  const held = new VoiceSession();
  held.press({ text: "memex" });
  assert.equal(held.release().notice, NOTICE_TOO_SHORT);
});

test("the listening deadline bounds a latched turn, which has no key to end it", () => {
  // The load-bearing one. A latched turn ignores `release`, so a deadline that
  // ended a listen by way of `release` would bound every turn in the design
  // except the only one with nobody's finger on the key. It reaches the model's
  // own window only once somebody is speaking; until then the shorter
  // initial-silence bound is what holds, which is the next test down.
  const session = new VoiceSession();
  session.press({ text: "", latch: true });
  session.armed();
  assert.equal(session.heard().deadline, LISTENING_DEADLINE_MS);

  const out = session.expired();
  assert.equal(out.capture, "stop", "the microphone closed");
  assert.equal(session.state, TRANSCRIBING, "and what it heard is transcribed");
  session.final("[BLANK_AUDIO]");
  assert.equal(session.state, IDLE, "the turn ends");
});

test("a hold released before the microphone opened is refused as too short", () => {
  const session = new VoiceSession();
  session.press({ text: "memex" });
  const effect = session.release({ heldMs: TAP_MS * 3 });
  assert.equal(effect.notice, NOTICE_TOO_SHORT);
  assert.equal(effect.input, "memex", "and the bar goes back to what it held");
  assert.equal(effect.run, null);
  assert.equal(session.state, IDLE);
});

/*
 * The bare tap, and the two bounds that made it offerable.
 *
 * The tap was held back for three runs because a mis-tap would open the
 * microphone for the full listening deadline. What these check is the answer to
 * that: the exposure was never a property of the tap — shift+F4 had exactly the
 * same one — but of a latched microphone bounded only by a clock.
 */

test("a key that comes back up inside the tap window latches instead of ending", () => {
  const session = new VoiceSession();
  session.press({ text: "half typed" });
  assert.equal(session.latched, false, "a press is a hold until proven a tap");
  session.armed();

  const up = session.release({ heldMs: TAP_MS - 1 });
  assert.equal(session.latched, true, "the tap latched it");
  assert.equal(up.capture, null, "the device stays open");
  assert.equal(session.state, LISTENING, "on the same turn, in the same stage");

  // And from here it is a latched turn like any other, ended by the next press.
  const ended = session.press({ text: "half typed" });
  assert.equal(ended.capture, "stop");
  assert.equal(session.final(" Enter cap.").run, "enter cap");
});

test("a hold is still a hold, and an unmeasured release is one too", () => {
  for (const heldMs of [TAP_MS, TAP_MS + 1, undefined]) {
    const session = new VoiceSession();
    session.press({ text: "" });
    session.armed();
    const up =
      heldMs === undefined ? session.release() : session.release({ heldMs });
    assert.equal(session.latched, false, `heldMs=${heldMs} did not latch`);
    assert.equal(up.capture, "stop", `heldMs=${heldMs} ended the turn`);
    assert.equal(session.state, TRANSCRIBING);
  }
});

test("a tap latched mid-arming picks up the silence bound when it starts listening", () => {
  // The microphone had not opened yet, so there was no listen to re-arm. The
  // bound has to arrive with the listen rather than with the gesture.
  const session = new VoiceSession();
  session.press({ text: "" });
  assert.equal(session.state, ARMING);
  session.release({ heldMs: 20 });
  assert.equal(session.armed().deadline, INITIAL_SILENCE_DEADLINE_MS);
});

test("a latched microphone that hears nothing closes itself, and transcribes nothing", () => {
  // The whole of the answer to the mis-tap objection. Six seconds rather than
  // thirty, no decode, and the notice a turn that produced no speech already
  // has — a mis-tap is not a thing the user should have to learn a word for.
  const session = new VoiceSession();
  session.press({ text: "memex" });
  assert.equal(
    session.armed().deadline,
    LISTENING_DEADLINE_MS,
    "held: no bound"
  );
  session.release({ heldMs: 10 });

  const out = session.expired();
  assert.equal(out.notice, NOTICE_NOTHING_HEARD);
  assert.equal(out.capture, "stop", "the device closed");
  assert.equal(out.input, "memex", "and the bar went back");
  assert.equal(out.run, null, "nothing ran");
  assert.equal(session.state, IDLE, "without going through the model");
});

test("a latched turn ends itself a beat after the speaking stops", () => {
  const c = clock();
  const session = new VoiceSession({ now: c.now });
  session.press({ text: "", latch: true });
  assert.equal(session.armed().deadline, INITIAL_SILENCE_DEADLINE_MS);

  c.tick(900);
  assert.equal(
    session.heard().deadline,
    LISTENING_DEADLINE_MS - 900,
    "speech lifts the initial-silence bound"
  );

  c.tick(1200);
  assert.equal(
    session.quiet().deadline,
    END_SILENCE_DEADLINE_MS,
    "and stopping arms the end-silence one"
  );

  const out = session.expired();
  assert.equal(out.capture, "stop");
  assert.equal(
    session.state,
    TRANSCRIBING,
    "this audio is real, so it is used"
  );
  assert.equal(session.final(" Enter cap.").run, "enter cap");
});

test("the gap between two words is not the end of an utterance", () => {
  // The end-silence deadline is the hysteresis, which is why the level check
  // needs none: a pause only means anything if it outlasts the bound.
  const c = clock();
  const session = new VoiceSession({ now: c.now });
  session.press({ text: "", latch: true });
  session.armed();
  c.tick(500);
  session.heard();

  c.tick(300);
  assert.equal(session.quiet().deadline, END_SILENCE_DEADLINE_MS);
  c.tick(200);
  assert.equal(
    session.heard().deadline,
    LISTENING_DEADLINE_MS - 1000,
    "the next word puts the model's window back"
  );
  assert.equal(session.state, LISTENING, "and the turn never ended");
});

test("a level report that says what is already true does not restart a clock", () => {
  // A word arriving every hundred milliseconds must not re-arm anything, or the
  // bound would only ever measure the gap since the last poll.
  const session = new VoiceSession({ now: clock().now });
  session.press({ text: "", latch: true });
  session.armed();
  session.heard();
  assert.equal(session.heard().deadline, null, "still speaking");
  session.quiet();
  assert.equal(session.quiet().deadline, null, "still quiet");
});

test("the silence bounds cannot push a turn past the model's own window", () => {
  // Whisper transcribes a fixed 30-second window and discards the rest, so a
  // bound expressed as time added to now — rather than as time remaining —
  // would quietly throw the user's last words away.
  const c = clock();
  const session = new VoiceSession({ now: c.now });
  session.press({ text: "", latch: true });
  session.armed();

  c.tick(LISTENING_DEADLINE_MS - 1000);
  assert.equal(session.heard().deadline, 1000, "a second of window is left");
  assert.equal(
    session.quiet().deadline,
    1000,
    "and end-silence is clamped to it rather than adding to it"
  );

  c.tick(2000);
  assert.equal(session.heard().deadline, 0, "past the window, nothing is left");
});

test("a held turn is bounded by the key and never by the room", () => {
  // A finger on the key is a user who is present. Ending their listen because
  // they paused to think would be the bound doing harm rather than good.
  const c = clock();
  const session = new VoiceSession({ now: c.now });
  session.press({ text: "kept" });
  assert.equal(session.armed().deadline, LISTENING_DEADLINE_MS);

  assert.equal(session.heard().deadline, null, "the level is not listened to");
  assert.equal(session.quiet().deadline, null);
  c.tick(LISTENING_DEADLINE_MS);
  assert.equal(session.state, LISTENING, "the turn is still going");
  assert.equal(
    session.release({ heldMs: 9000 }).capture,
    "stop",
    "until let go"
  );
});

test("a level report outside a listen is ignored, like every other stale event", () => {
  const session = new VoiceSession();
  assert.equal(session.heard().deadline, null, "idle");
  session.press({ text: "", latch: true });
  assert.equal(session.heard().deadline, null, "arming");
  session.armed();
  session.press({ text: "" });
  assert.equal(session.state, TRANSCRIBING);
  assert.equal(session.quiet().deadline, null, "transcribing");
});

test("silence does not execute, and puts the bar back", () => {
  for (const transcript of [" Thank you.", "[BLANK_AUDIO]", "   "]) {
    const session = new VoiceSession();
    session.press({ text: "xanadu" });
    session.armed();
    session.release();
    const effect = session.final(transcript);
    assert.equal(effect.run, null, transcript);
    assert.equal(effect.notice, NOTICE_NOTHING_HEARD, transcript);
    assert.equal(effect.input, "xanadu", transcript);
  }
});

test("cancel works from every state and never executes", () => {
  for (const stage of [ARMING, LISTENING, TRANSCRIBING]) {
    const session = new VoiceSession();
    session.press({ text: "kept" });
    if (stage !== ARMING) {
      session.armed();
      session.partial("dismiss cap");
    }
    if (stage === TRANSCRIBING) {
      session.release();
    }
    assert.equal(session.state, stage);

    const effect = session.cancel();
    assert.equal(effect.run, null, stage);
    assert.equal(effect.input, "kept", stage);
    assert.equal(effect.capture, "stop", stage);
    assert.equal(session.state, IDLE, stage);
    assert.equal(session.echo, "", stage);
  }
});

test("a cancelled turn cannot be completed by a transcript that arrives late", () => {
  const session = new VoiceSession();
  session.press({ text: "" });
  session.armed();
  session.release();
  session.cancel();

  const late = session.final("dismiss cap");
  assert.equal(late.run, null, "the model finished after the user gave up");
  assert.equal(late.input, null);
  assert.equal(session.state, IDLE);
});

test("typing wins, and does not delete what was typed", () => {
  const session = new VoiceSession();
  session.press({ text: "" });
  session.armed();
  session.partial("enter");

  const effect = session.typed();
  assert.equal(effect.input, null, "the keystroke's own text is left alone");
  assert.equal(effect.run, null);
  assert.equal(effect.capture, "stop");
  assert.equal(session.active, false);

  assert.equal(
    session.final("enter cap").run,
    null,
    "and the turn stays abandoned"
  );
});

test("a failure ends the turn and puts the bar back", () => {
  const session = new VoiceSession();
  session.press({ text: "trails" });
  const effect = session.failed();
  assert.equal(effect.notice, NOTICE_UNAVAILABLE);
  assert.equal(effect.input, "trails");
  assert.equal(effect.capture, "stop");
  assert.equal(session.state, IDLE);
});

test("an unusable partial leaves the echo standing rather than blanking the line", () => {
  const session = new VoiceSession();
  session.press({ text: "" });
  session.armed();
  session.partial("enter cap");
  const effect = session.partial("[cough]");
  assert.equal(effect.input, null);
  assert.equal(session.echo, "enter cap");
});

test("events out of order are ignored rather than half-applied", () => {
  const session = new VoiceSession();
  assert.equal(session.armed().state, IDLE);
  assert.equal(session.release().state, IDLE);
  assert.equal(session.partial("enter cap").input, null);
  assert.equal(session.final("enter cap").run, null);
  assert.equal(session.cancel().capture, null);
  assert.equal(session.typed().capture, null);
  assert.equal(session.echo, "");

  session.press({ text: "" });
  assert.equal(
    session.final("enter cap").run,
    null,
    "no transcript before a release"
  );
  assert.equal(session.state, ARMING);
});

/**
 * Drive a session to `stage` and hand it back, so the deadline tests can say
 * which stage they mean rather than replaying the turn each time.
 *
 * @param {string} stage
 * @param {string} [text] What the bar held when the turn began.
 * @param {boolean} [latch] Reach the stage by the latched gesture instead.
 */
function at(stage, text = "kept", latch = false) {
  const session = new VoiceSession();
  session.press({ text, latch });
  if (stage !== ARMING) {
    session.armed();
  }
  if (stage === TRANSCRIBING) {
    // Each gesture reaches the stage by its own means: a held turn by the key
    // coming up, a latched one by the press that ends it, which is the whole
    // of the difference between them.
    if (latch) {
      session.press({ text });
    } else {
      session.release();
    }
  }
  assert.equal(session.state, stage);
  return session;
}

test("every stage is entered with the deadline it is allowed to last", () => {
  const session = new VoiceSession();
  assert.equal(session.press({ text: "" }).deadline, ARMING_DEADLINE_MS);
  assert.equal(session.armed().deadline, LISTENING_DEADLINE_MS);
  assert.equal(session.release().deadline, TRANSCRIBING_DEADLINE_MS);
  assert.equal(
    session.final("enter cap").deadline,
    null,
    "the turn is over, and idle is what clears the timer"
  );
});

test("an ignored event carries no deadline, so it cannot restart an open microphone", () => {
  const session = at(LISTENING);
  assert.equal(
    session.press({ text: "auto-repeat" }).deadline,
    null,
    "the whole point: holding the key must not extend the listen"
  );
  assert.equal(
    session.partial("enter cap").deadline,
    null,
    "and neither does speaking — the cap is on the microphone, not on silence"
  );
  assert.equal(
    session.armed().deadline,
    null,
    "nor does an out-of-order event"
  );
});

test("a listen that runs out is transcribed, not thrown away", () => {
  const session = at(LISTENING);
  session.partial("enter cap");

  const effect = session.expired();
  assert.equal(session.state, TRANSCRIBING);
  assert.equal(effect.capture, "stop", "the microphone closes at the deadline");
  assert.equal(effect.deadline, TRANSCRIBING_DEADLINE_MS);
  assert.equal(effect.input, null, "what was heard so far stands");
  assert.equal(session.echo, "enter cap");

  assert.equal(
    session.final("enter cap").run,
    "enter cap",
    "a long utterance still runs"
  );
});

test("a listen that ran out on a lost key-up hears a room, and refuses it", () => {
  const session = at(LISTENING, "xanadu");
  session.expired();

  // Nobody spoke into the tail, so the model answers it the way Whisper
  // answers silence. The deadline needs no way to tell this case from a long
  // utterance, because the gate that already exists tells them apart.
  const effect = session.final(" Thank you.");
  assert.equal(effect.run, null);
  assert.equal(effect.notice, NOTICE_NOTHING_HEARD);
  assert.equal(effect.input, "xanadu");
});

test("an arm or a transcribe that runs out reports the failure that stage has", () => {
  for (const stage of [ARMING, TRANSCRIBING]) {
    const session = at(stage);
    const effect = session.expired();
    assert.equal(effect.notice, NOTICE_UNAVAILABLE, stage);
    assert.equal(effect.input, "kept", stage);
    assert.equal(effect.run, null, stage);
    assert.equal(effect.capture, "stop", stage);
    assert.equal(session.state, IDLE, stage);
  }
});

test("a deadline that arrives with no turn under way does nothing", () => {
  const session = new VoiceSession();
  const effect = session.expired();
  assert.equal(session.state, IDLE);
  assert.deepEqual(
    effect,
    {
      state: IDLE,
      input: null,
      notice: null,
      run: null,
      capture: null,
      deadline: null,
    },
    "a timer the shell forgot to clear cannot disturb the bar"
  );
});

test("losing focus ends the turn without executing", () => {
  for (const stage of [ARMING, LISTENING, TRANSCRIBING]) {
    const session = at(stage);
    const effect = session.blurred();
    assert.equal(effect.capture, "stop", stage);
    assert.equal(effect.run, null, stage);
    assert.equal(effect.input, "kept", stage);
    assert.equal(session.state, IDLE, stage);
  }
});

test("a transcript arriving after a blur does nothing, as after a cancel", () => {
  const session = at(TRANSCRIBING);
  session.blurred();
  assert.equal(session.final("enter cap").run, null);
});

/**
 * The invariant the deadlines exist for. A chrome `getUserMedia` raises no
 * prompt and lights no indicator, so a microphone this state machine opens and
 * does not close is a microphone with nothing at all to notice it by. Asserting
 * it per-path would leave the next path added uncovered; asserting it over
 * every abandoning event from every stage is what makes it a property of the
 * machine.
 *
 * It runs over both gestures, because a latched turn is the one that has no
 * finger on a key and so is the one where a microphone left open would be least
 * likely to be noticed.
 *
 * These five are the events that mean "this turn is over" whenever they arrive.
 * `release` and `final` are deliberately not among them: they are the ordinary
 * progress of a turn and are only defined at the stage they belong to, which
 * the out-of-order test covers. The safety claim is about abandonment, because
 * abandonment is what happens when something has gone wrong.
 */
test("every way out of every stage closes the microphone and lands on idle", () => {
  const enders = {
    cancel: s => s.cancel(),
    typed: s => s.typed(),
    blurred: s => s.blurred(),
    failed: s => s.failed(),
    expired: s => s.expired(),
  };

  for (const latch of [false, true]) {
    for (const stage of [ARMING, LISTENING, TRANSCRIBING]) {
      for (const [event, end] of Object.entries(enders)) {
        const session = at(stage, "kept", latch);
        const where = `${event} from ${stage}${latch ? " (latched)" : ""}`;

        let effect = end(session);
        // release and expired hand a listen on to be transcribed rather than
        // ending the turn; the microphone must already have closed, and the
        // one stage left has to end too.
        if (session.state === TRANSCRIBING) {
          assert.equal(
            effect.capture,
            "stop",
            `${where} closed the microphone`
          );
          effect = session.final("[BLANK_AUDIO]");
        }

        assert.equal(session.state, IDLE, `${where} reached idle`);
        assert.equal(
          session.active,
          false,
          `${where} left no timer for the shell to run`
        );
        assert.equal(
          session.latched,
          false,
          `${where} left no latch behind either`
        );
      }
    }
  }
});

test("audio the gate refused ends the turn with the reason it was refused for", () => {
  // The gate runs in the shell, because only the shell has the samples, but
  // its verdict is a turn-ending event like any other and the words the user
  // gets are the session's to choose. Too quiet and too short are told apart
  // on purpose: a user who really did speak, quietly, must not be taught that
  // the microphone heard nothing.
  for (const [reason, notice] of [
    [TOO_QUIET, NOTICE_TOO_QUIET],
    [TOO_SHORT, NOTICE_TOO_SHORT],
  ]) {
    const session = new VoiceSession();
    session.press({ text: "half typed" });
    session.armed();
    session.release();

    const effect = session.refused(reason);
    assert.equal(effect.state, IDLE, "the turn is over");
    assert.equal(effect.notice, notice, "with the reason it was refused for");
    assert.equal(effect.run, null, "and nothing runs");
    assert.equal(effect.input, "half typed", "the line comes back");
  }
});

test("a refusal outside transcribing is ignored, like every other stale event", () => {
  const session = new VoiceSession();
  assert.equal(session.refused(TOO_QUIET).state, IDLE);
  assert.equal(session.notice, null, "an idle session says nothing");

  session.press({ text: "" });
  const midArming = session.refused(TOO_QUIET);
  assert.equal(midArming.state, ARMING, "arming is untouched by a verdict");
  assert.equal(midArming.notice, null, "and no notice is raised");
  assert.equal(midArming.capture, null, "and the microphone is left alone");
});
