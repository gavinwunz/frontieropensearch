/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * The voice front end in a real chrome window.
 *
 * The turn itself is covered in node (`tests/node/test_voice.mjs`) and is not
 * repeated here — every state, every deadline and every way out of one is
 * already asserted there without a browser. What this file covers is the half
 * node cannot see, which is the half that has broken every other pillar first:
 * that the key is really bound, that the microphone really closes, that the
 * transcript really reaches the same parser a keystroke reaches, and that the
 * indicator the platform refuses to draw is really on the window.
 *
 * There is no microphone and no model in here. Both are replaced through
 * `useBackend`, which is what lets the shell's own decisions be tested in
 * milliseconds rather than in 45MB of weights — and what lets a recording be
 * made too quiet on purpose, which no real microphone would cooperate with.
 * The engine that does run for real is measured, not asserted, in
 * `browser_zzvoicelatency.js`.
 *
 * It all happens in a window of its own. These tests bind handlers to verbs
 * the pillars have already claimed, and a dispatcher belongs to a window, so a
 * separate window is what keeps `enter` meaning what pillar A says it means in
 * every other file of this suite.
 */

const { FOSVoiceInput, TALK_KEY } = ChromeUtils.importESModule(
  "resource:///modules/FOSVoiceInput.sys.mjs"
);
const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { IDLE, LISTENING, TAP_MS } = ChromeUtils.importESModule(
  "resource:///modules/FOSVoiceSession.sys.mjs"
);
const { MIN_RMS } = ChromeUtils.importESModule(
  "resource:///modules/FOSVoiceTranscript.sys.mjs"
);
const { markWord } = ChromeUtils.importESModule(
  "resource:///modules/FOSMarks.sys.mjs"
);

let win;

function bar() {
  return FOSCommandBar.forWindow(win);
}

function voice() {
  return FOSVoiceInput.forWindow(win);
}

/**
 * A recording of one second, loud enough and peaky enough to clear the audio
 * gate — or, at an amplitude near zero, quiet enough to be refused by it.
 *
 * @param {number} [amplitude]
 * @returns {{samples: Float32Array, sampleRate: number}}
 */
function recording(amplitude = 0.2) {
  const samples = new Float32Array(16000);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = i % 2 ? amplitude : -amplitude;
  }
  return { samples, sampleRate: 16000 };
}

/**
 * A microphone and a model, as two objects that count what was asked of them.
 *
 * @param {object} [options]
 * @param {string} [options.transcript] What the model answers with.
 * @param {object} [options.audio] What the microphone hands back.
 * @param {boolean} [options.weights] Whether the weights are already present.
 * @param {boolean} [options.hold] Keep the engine unfinished until told.
 * @returns {object} The counters, which the assertions read.
 */
function backend({
  transcript = " Enter cap.",
  audio,
  weights = true,
  hold = false,
} = {}) {
  const counts = {
    started: 0,
    stopped: 0,
    aborted: 0,
    open: false,
    requests: [],
    engines: 0,
    progressed: false,
  };

  // A download takes time, and the point of the test that uses this is what
  // the user is looking at while it does. Holding the engine open until the
  // test says so is the only way to observe that at all — an engine that
  // resolves in the same tick is already ready by the first poll.
  let finished;
  const gate = hold ? new Promise(resolve => (finished = resolve)) : null;
  counts.finish = () => finished?.();

  const recorder = {
    async start() {
      counts.started++;
      counts.open = true;
    },
    async stop() {
      counts.stopped++;
      counts.open = false;
      return audio ?? recording();
    },
    abort() {
      counts.aborted++;
      counts.open = false;
    },
  };

  // What the room sounds like, which the front end wires to `onLevel` when it
  // adopts this recorder. Driving it by hand is the only way to test the two
  // bounds a latched turn has without making a noise at a real microphone.
  //
  // `monitoring` is what the real recorder reports about whether its own level
  // monitor is delivering, and the turn refuses to trust silence without it.
  // The double says yes because these tests are about what the turn does with
  // the reports; the test below covers a recorder that says no.
  recorder.monitoring = true;
  counts.recorder = recorder;
  counts.level = loud => recorder.onLevel?.(loud);

  const engine = {
    async run(request) {
      counts.requests.push(request);
      return { text: transcript };
    },
    async terminate() {},
  };

  voice().useBackend({
    recorder,
    // The real `ModelHub.listFiles` resolves to `{files, metadata}`. The double
    // said an array for thirteen runs and taught the production code to believe
    // it, which is how the presence check came to answer "no" forever.
    listFiles: async () => ({ files: weights ? [{ path: "model.onnx" }] : [] }),
    createEngine: async onProgress => {
      counts.engines++;
      if (onProgress) {
        counts.progressed = true;
        onProgress({ progress: 42 });
      }
      await gate;
      return engine;
    },
  });
  return counts;
}

/**
 * When the talk key last went down, in the test's own clock.
 *
 * A press is a hold or a tap depending on how long it lasts, and these tests
 * synthesise both halves of the gesture in less time than any hand could. So a
 * test that means to hold has to actually hold — see `releaseTalkKey`.
 */
let pressedAt = 0;

function talkKey(type) {
  if (type === "keydown") {
    pressedAt = Date.now();
  }
  EventUtils.synthesizeKey(`KEY_${TALK_KEY}`, { type }, win);
}

/** Hold the talk key, and wait until the microphone is actually open. */
async function holdTalkKey() {
  talkKey("keydown");
  await TestUtils.waitForCondition(
    () => voice().state === LISTENING,
    "the turn reaches listening"
  );
}

/**
 * Wait out whatever is left of the tap window.
 *
 * The margin is not superstition. The shell measures the hold from the events'
 * own timestamps and this measures it from `Date.now()`, and while both count
 * the same real interval they do not start from the same instant, so a wait of
 * exactly `TAP_MS` would sit on the boundary it is trying to clear.
 */
async function outlastTheTapWindow() {
  const left = TAP_MS + 100 - (Date.now() - pressedAt);
  if (left > 0) {
    await new Promise(resolve => win.setTimeout(resolve, left));
  }
}

/**
 * Latch a turn with shift, and let the key go.
 *
 * The key-up is sent immediately and deliberately, usually while the turn is
 * still arming: a latched turn that could be killed by the release of the very
 * key that started it would be no use to the users it exists for.
 */
async function latchTalkKey() {
  EventUtils.synthesizeKey(
    `KEY_${TALK_KEY}`,
    { type: "keydown", shiftKey: true },
    win
  );
  EventUtils.synthesizeKey(
    `KEY_${TALK_KEY}`,
    { type: "keyup", shiftKey: true },
    win
  );
  await TestUtils.waitForCondition(
    () => voice().state === LISTENING,
    "the latched turn reaches listening"
  );
}

/** Let it go, and wait until the turn is over. */
async function releaseTalkKey() {
  await outlastTheTapWindow();
  talkKey("keyup");
  await TestUtils.waitForCondition(
    () => voice().state === IDLE,
    "the turn ends"
  );
}

function indicator() {
  return win.document.querySelector(".fos-voice-indicator");
}

function reportText() {
  const report = win.document.querySelector(".fos-report");
  return report && !report.hidden ? report.textContent : "";
}

add_setup(async function () {
  win = await BrowserTestUtils.openNewBrowserWindow();
  await SimpleTest.promiseFocus(win);
});

registerCleanupFunction(async () => {
  voice().destroy();
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_the_key_is_bound_and_a_press_is_the_whole_turn() {
  const mic = backend({ transcript: " what" });
  const ran = [];
  bar().actions.register("what", command => {
    ran.push(command.action);
    return true;
  });

  Assert.ok(!bar().isOpen, "the bar starts closed");

  await holdTalkKey();

  Assert.ok(bar().isOpen, "the press opened the bar to speak into");
  Assert.equal(mic.started, 1, "the microphone opened");
  Assert.ok(mic.open, "and is open while the key is down");
  Assert.equal(indicator().hidden, false, "the indicator is showing");
  Assert.equal(
    indicator().getAttribute("data-stage"),
    LISTENING,
    "and says which stage the turn is in"
  );

  await releaseTalkKey();

  Assert.equal(mic.stopped, 1, "the key coming up stopped the recording");
  Assert.ok(!mic.open, "and closed the device");
  Assert.equal(mic.requests.length, 1, "the model was asked once");
  Assert.equal(
    mic.requests[0].args[0].length,
    16000,
    "and was given samples, not a blob"
  );
  Assert.deepEqual(ran, ["what"], "and the line it heard ran");
  Assert.ok(!bar().isOpen, "the bar closed behind the command");
  Assert.equal(indicator().hidden, true, "the indicator is gone");
});

add_task(async function test_shift_latches_a_turn_that_no_key_is_holding() {
  // The second gesture, and the users it is for are the ones a held key
  // excludes. It is the same turn — same device, same model, same line handed
  // to the same parser — and the only difference is that the key comes up in
  // the middle of it rather than ending it.
  const mic = backend({ transcript: " what" });
  const ran = [];
  bar().actions.register("what", command => {
    ran.push(command.action);
    return true;
  });

  await latchTalkKey();

  Assert.ok(mic.open, "the microphone is open with no key held down");
  Assert.equal(mic.stopped, 0, "the key coming up stopped nothing");
  Assert.equal(mic.aborted, 0, "and abandoned nothing");
  Assert.equal(
    indicator().getAttribute("data-stage"),
    LISTENING,
    "and the turn is listening, not over"
  );

  // A press without the modifier ends it. A user who latched with shift and
  // then reached back for the key alone has asked to stop, and ending a turn
  // early costs an utterance where failing to end one costs an open
  // microphone that nothing in the platform will draw an indicator for.
  talkKey("keydown");
  await TestUtils.waitForCondition(
    () => voice().state === IDLE,
    "the second press ends the turn"
  );

  Assert.equal(mic.stopped, 1, "the second press closed the device");
  Assert.ok(!mic.open);
  Assert.equal(mic.requests.length, 1, "the model was asked once");
  Assert.deepEqual(ran, ["what"], "and the line ran, as a held turn's does");
  Assert.equal(indicator().hidden, true, "the indicator is gone");

  talkKey("keyup");
  Assert.equal(voice().state, IDLE, "that press's own key-up starts nothing");
});

add_task(async function test_a_bare_tap_latches_and_the_utterance_ends_it() {
  // The gesture this browser can now offer that it could not before, and the
  // one a user with a single reliable finger would actually pick: no modifier,
  // no chord, no second key. The node tests own the state machine; what needs
  // a real window is that a real key-up inside the tap window comes out the
  // other side as a latch rather than as "too short to hear".
  const mic = backend({ transcript: " what" });
  const ran = [];
  bar().actions.register("what", command => {
    ran.push(command.action);
    return true;
  });

  talkKey("keydown");
  talkKey("keyup");
  await TestUtils.waitForCondition(
    () => voice().state === LISTENING,
    "the tapped turn reaches listening"
  );

  Assert.ok(
    mic.open,
    "the microphone is open with no key held and no modifier"
  );
  Assert.equal(mic.stopped, 0, "the key coming up ended nothing");
  Assert.equal(
    indicator().hasAttribute("data-latched"),
    true,
    "and the indicator says how to stop, as it does for any latched turn"
  );

  // And the utterance ends the turn, which is the half that makes one gesture
  // enough. Nobody presses anything again.
  mic.level(true);
  mic.level(false);
  await TestUtils.waitForCondition(
    () => voice().state === IDLE,
    "the turn ends itself a beat after the speaking stops"
  );

  Assert.equal(mic.stopped, 1, "the device closed on its own");
  Assert.ok(!mic.open);
  Assert.deepEqual(ran, ["what"], "and the line it heard ran");
});

add_task(async function test_a_latched_microphone_nobody_spoke_into_closes() {
  // The objection that kept the bare tap unbuilt for three runs, answered end
  // to end: a microphone opened by a key nobody meant to press closes itself,
  // and does it without spending a decode on six seconds of a quiet room.
  //
  // This test waits out a real deadline, which is why it is the only one here
  // that does. The bound is the whole claim, and a bound nothing ever waits for
  // is a number in a file.
  const mic = backend();
  // Open the bar and put a line in it first: what a turn restores is what the
  // bar was holding when the turn began, and a bar that was closed was holding
  // nothing.
  bar().open();
  bar().input.value = "memex";

  talkKey("keydown");
  talkKey("keyup");
  await TestUtils.waitForCondition(
    () => voice().state === LISTENING,
    "the mis-tapped turn reaches listening"
  );

  await TestUtils.waitForCondition(
    () => voice().state === IDLE,
    "the microphone closes itself on silence",
    250,
    40
  );

  Assert.ok(!mic.open, "the device is closed");
  Assert.equal(mic.requests.length, 0, "and the model was never asked");
  Assert.equal(bar().input.value, "memex", "the line the user had came back");
  Assert.ok(bar().isOpen, "in the bar the user already had open");
  bar().close();
});

add_task(async function test_the_level_monitor_runs_against_a_real_capture() {
  // Everything else in this file replaces the microphone, so nothing else
  // touches the code that listens to one. This covers the mechanism that code
  // depends on, against a real captured stream, and the one part of it that
  // could plausibly not work: the analyser is read without being connected
  // onward to anything, because routing a microphone to the speakers is how a
  // browser gets feedback, and a node in a graph reaching no destination is
  // exactly the shape that might never be pulled.
  //
  // **This build machine cannot run the positive half.** It has no audio output
  // device — no `/dev/snd`, and `destination.maxChannelCount` is 0 — so the
  // graph never leaves `suspended` and reads a flat zero forever. Needing an
  // *output* device in order to measure an *input* one is a Web Audio fact
  // rather than a fault in the code, and it is exactly the condition
  // `MicRecorder` degrades for. On a machine like this one the test asserts the
  // degradation instead, and says out loud that it did.
  //
  // (Autoplay was the first suspect and is not the cause: `IsAllowedToPlay`
  // returns early here because `media.autoplay.default` is 0, and the context
  // stays suspended with user activation and an active capture both in place.)
  await SpecialPowers.pushPrefEnv({
    set: [
      ["media.navigator.streams.fake", true],
      ["media.navigator.permission.disabled", true],
    ],
  });

  const stream = await win.navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1 },
  });

  const context = new win.AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const frame = new Float32Array(analyser.fftSize);
  const rms = () => {
    analyser.getFloatTimeDomainData(frame);
    let sum = 0;
    for (const sample of frame) {
      sum += sample * sample;
    }
    return Math.sqrt(sum / frame.length);
  };

  if (context.destination.maxChannelCount > 0) {
    await TestUtils.waitForCondition(
      () => context.state === "running",
      "the graph starts"
    );
    await TestUtils.waitForCondition(
      () => rms() >= MIN_RMS,
      "the analyser is pulled with nothing connected after it"
    );
  } else {
    info(
      "NO AUDIO OUTPUT DEVICE on this machine, so the positive half of this " +
        "test did not run. What follows is the fallback it degrades to."
    );
    // Half a second is the grace `MicRecorder` allows the graph to start, so a
    // context still suspended here is one the monitor would give up on.
    await new Promise(resolve => win.setTimeout(resolve, 600));
    Assert.equal(
      context.state,
      "suspended",
      "the graph never started, which is what the monitor has to survive"
    );
    Assert.equal(rms(), 0, "and reads exactly what a silent room reads");
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
  await context.close();
  await SpecialPowers.popPrefEnv();
});

add_task(
  async function test_a_turn_whose_monitor_is_dead_does_not_hear_silence() {
    // The failure the check above exists to prevent, from the turn's side. A
    // monitor that is not delivering reads exactly like a quiet room, so a turn
    // that assumed one was there would cut somebody off six seconds into a
    // sentence. Without one the turn falls back to the key and the model's
    // window — the design that shipped before the bounds existed.
    const mic = backend({ transcript: " what" });
    mic.recorder.monitoring = false;
    const ran = [];
    bar().actions.register("what", command => {
      ran.push(command.action);
      return true;
    });

    talkKey("keydown");
    talkKey("keyup");
    await TestUtils.waitForCondition(
      () => voice().state === LISTENING,
      "the tapped turn reaches listening"
    );

    // Long enough that a turn which had armed the initial-silence bound would be
    // over by now, and this one is not.
    await new Promise(resolve => win.setTimeout(resolve, 7000));
    Assert.equal(
      voice().state,
      LISTENING,
      "still listening after seven seconds"
    );
    Assert.ok(
      mic.open,
      "the microphone was not closed on a silence never heard"
    );

    // And it still ends the ordinary way.
    talkKey("keydown");
    await TestUtils.waitForCondition(
      () => voice().state === IDLE,
      "the second press ends it"
    );
    Assert.deepEqual(ran, ["what"], "and the line ran");
    talkKey("keyup");
  }
);

add_task(async function test_a_latched_turn_says_how_to_stop() {
  // A held turn's answer to "how do I stop this" is the finger already on the
  // key. A latched turn has an open microphone that nobody is touching, and
  // this indicator is the only thing in the browser that says so, so it is
  // where the gesture that closes it has to be.
  backend();
  const stop = () => win.document.querySelector(".fos-voice-stop");

  await holdTalkKey();
  Assert.equal(
    win.getComputedStyle(stop()).display,
    "none",
    "a held turn offers no stop line, because the key is the answer"
  );
  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  Assert.equal(voice().state, IDLE, "cancelled");

  await latchTalkKey();
  Assert.notEqual(
    win.getComputedStyle(stop()).display,
    "none",
    "a latched turn offers one"
  );
  Assert.ok(
    stop().textContent.includes(TALK_KEY),
    "naming the key that ends it"
  );

  // Once the model is working a press would do nothing, so the line goes — but
  // its space stays, or the indicator would resize under the eye that is
  // reading it. Driven on the element rather than through a turn, because
  // holding a real turn in `transcribing` needs a model that hangs.
  const element = indicator();
  const width = element.getBoundingClientRect().width;
  element.setAttribute("data-stage", "transcribing");
  Assert.equal(
    win.getComputedStyle(stop()).visibility,
    "hidden",
    "the line goes when a press would do nothing"
  );
  Assert.equal(
    element.getBoundingClientRect().width,
    width,
    "and its space does not, so the indicator holds still"
  );

  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  Assert.equal(voice().state, IDLE, "cancelled");
});

add_task(async function test_a_transcript_is_a_line_like_any_other() {
  // GRAMMAR.md §5's requirement, as the only test that can actually check it:
  // the shell hands the bar a string and nothing downstream is told where it
  // came from. So a spoken mark has to resolve through the registry the
  // keyboard uses, and a spoken line that does not parse has to be left in
  // front of the user rather than run. Both are the keyboard's behaviour,
  // unchanged, which is the point.
  const seen = [];
  bar().actions.register("enter", command => {
    seen.push(command.target ?? null);
    return true;
  });
  const letter = bar().marks.assign("test-node", {
    label: "a page",
    type: "node",
  });

  backend({ transcript: `Enter, ${markWord(letter)}.` });
  await holdTalkKey();
  await releaseTalkKey();

  Assert.deepEqual(
    seen,
    [letter],
    "the spoken mark resolved to the same letter the keyboard would type"
  );

  // Now a line that does not parse. `enter` needs a target, so it is
  // incomplete rather than wrong, and an incomplete line is exactly what the
  // candidate list in front of the user is for — GRAMMAR.md §8's "a misheard
  // word is offered, not repaired".
  const second = backend({ transcript: "enter" });
  await holdTalkKey();
  await releaseTalkKey();

  Assert.equal(second.requests.length, 1, "the utterance was transcribed");
  Assert.ok(bar().isOpen, "an unrunnable line leaves the bar open");
  Assert.equal(
    bar().input.value,
    "enter",
    "holding what was heard, for the user to finish or correct"
  );
  Assert.deepEqual(seen, [letter], "and nothing ran a second time");

  bar().close();
  bar().marks.clear();
});

add_task(async function test_escape_abandons_a_turn_and_closes_the_device() {
  const mic = backend();

  await holdTalkKey();
  EventUtils.synthesizeKey("KEY_Escape", {}, win);

  Assert.equal(voice().state, IDLE, "the turn is over");
  Assert.equal(mic.aborted, 1, "the recording was thrown away");
  Assert.ok(!mic.open, "the device closed on the cancel, not on a deadline");
  Assert.equal(mic.requests.length, 0, "nothing was transcribed");
  Assert.equal(indicator().hidden, true, "and the indicator went with it");
  Assert.ok(!bar().isOpen, "the bar this turn opened closed again");

  // The key coming up after a cancel must not start anything, or Escape would
  // only postpone the command it was pressed to stop.
  talkKey("keyup");
  Assert.equal(voice().state, IDLE, "a late key-up does nothing");
  Assert.equal(mic.requests.length, 0, "and still nothing was transcribed");
});

add_task(async function test_typing_wins_and_keeps_what_was_typed() {
  const mic = backend();
  // Typed rather than handed to `open`, because opening the bar selects what
  // is in it: a test that skipped the typing would be testing what happens to
  // a selection, which is not what this is about.
  bar().open();
  EventUtils.synthesizeKey("n", {}, win);
  EventUtils.synthesizeKey("a", {}, win);

  await holdTalkKey();
  EventUtils.synthesizeKey("m", {}, win);

  Assert.equal(voice().state, IDLE, "the utterance was abandoned");
  Assert.equal(mic.aborted, 1, "and the microphone closed");
  Assert.equal(
    bar().input.value,
    "nam",
    "the keystroke is intact — restoring the snapshot would have eaten it"
  );
  Assert.ok(bar().isOpen, "the bar the user opened is still theirs");

  talkKey("keyup");
  Assert.equal(mic.requests.length, 0, "nothing was transcribed");
  bar().close();
});

add_task(async function test_a_quiet_room_never_reaches_the_model() {
  // The defence that matters most. Whisper answers silence with a confident
  // sentence, and a sentence nobody said would be recorded by the Context
  // Engine as a question the user asked, which is a great deal harder to
  // notice than a search that ran and looked odd.
  const mic = backend({ audio: recording(0.0005) });

  await holdTalkKey();
  await releaseTalkKey();

  Assert.equal(mic.stopped, 1, "the recording was made");
  Assert.equal(mic.requests.length, 0, "and refused before the model saw it");
  Assert.ok(
    reportText().toLowerCase().includes("quiet"),
    `the user is told why rather than told nothing: "${reportText()}"`
  );
  Assert.ok(!bar().isOpen, "and the bar is back the way it was found");
  bar().dismissNotice();
});

add_task(async function test_a_latched_turn_is_never_told_to_hold_a_key() {
  // The audio gate's "too short" is reachable by both gestures — a latched
  // turn gets there by two presses in quick succession — and the words it had
  // were advice about the gesture the user did not use. The notice is the
  // shell's to word, so this is the surface that can catch it.
  const mic = backend({
    audio: { samples: new Float32Array(160), sampleRate: 16000 },
  });

  await latchTalkKey();
  talkKey("keydown");
  await TestUtils.waitForCondition(
    () => voice().state === IDLE,
    "the turn ends"
  );
  talkKey("keyup");

  Assert.equal(mic.requests.length, 0, "the model never saw it");
  const words = reportText();
  Assert.ok(
    words.toLowerCase().includes("short"),
    `the user is told why: "${words}"`
  );
  Assert.ok(
    words.includes(TALK_KEY),
    "in terms of the gesture they are actually using"
  );
  Assert.ok(
    !words.toLowerCase().includes("hold"),
    `and is not told to hold a key they are not holding: "${words}"`
  );
  bar().dismissNotice();

  // The held turn keeps the words that are right for it.
  backend({ audio: { samples: new Float32Array(160), sampleRate: 16000 } });
  await holdTalkKey();
  await releaseTalkKey();
  Assert.ok(
    reportText().toLowerCase().includes("hold"),
    `a held turn is still told to hold the key: "${reportText()}"`
  );
  bar().dismissNotice();
});

add_task(async function test_the_weights_are_a_visible_one_time_step() {
  // GRAMMAR.md §8's last rule. The press is what asks for the download, so the
  // download is allowed to happen — what is not allowed is a microphone that
  // sits open and then fails with an error about a fetch nobody asked for.
  const mic = backend({ weights: false, hold: true });

  talkKey("keydown");
  await TestUtils.waitForCondition(
    () => reportText().includes("Downloading"),
    "the download is announced"
  );

  Assert.equal(voice().state, IDLE, "no turn is left hanging");
  Assert.ok(!mic.open, "and no microphone is left open");
  Assert.equal(mic.requests.length, 0, "nothing was transcribed");
  Assert.ok(
    reportText().includes("MB"),
    `the size is part of the offer: "${reportText()}"`
  );

  mic.finish();
  await TestUtils.waitForCondition(
    () => reportText().includes("ready"),
    "and the user is told when it is usable"
  );
  Assert.ok(mic.progressed, "progress was reported while it ran");
  Assert.equal(
    mic.engines,
    1,
    "one engine, which is both the fetch and the load"
  );

  talkKey("keyup");
  bar().dismissNotice();
  bar().close();
});

add_task(async function test_the_indicator_is_on_the_window() {
  // It is the only signal there is. A chrome window's getUserMedia never
  // prompts, never lights the platform's sharing indicator and never appears
  // in the permissions UI, so this element carries all of it — which is why it
  // is a live region on the window rather than a decoration inside the bar.
  backend();
  await holdTalkKey();

  const element = indicator();
  Assert.equal(element.getAttribute("role"), "status", "it is announced");
  Assert.equal(
    element.getAttribute("aria-live"),
    "polite",
    "as a live region, since nothing else will say it"
  );
  Assert.equal(
    element.closest(".fos-commandbar-backdrop"),
    null,
    "and it is not inside the bar, which is redrawn on every keystroke"
  );
  Assert.greater(
    element.getBoundingClientRect().height,
    0,
    "the stylesheet arrived with it, so it has a size on its first frame"
  );

  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  Assert.equal(voice().state, IDLE, "cancelled");
});
