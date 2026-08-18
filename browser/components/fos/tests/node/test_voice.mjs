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
  IDLE,
  LISTENING,
  NOTICE_NOTHING_HEARD,
  NOTICE_TOO_SHORT,
  NOTICE_UNAVAILABLE,
  TRANSCRIBING,
  VoiceSession,
} from "../../FOSVoiceSession.sys.mjs";

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

test("a tap that never reaches the microphone is refused as too short", () => {
  const session = new VoiceSession();
  session.press({ text: "memex" });
  const effect = session.release();
  assert.equal(effect.notice, NOTICE_TOO_SHORT);
  assert.equal(effect.input, "memex", "and the bar goes back to what it held");
  assert.equal(effect.run, null);
  assert.equal(session.state, IDLE);
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
