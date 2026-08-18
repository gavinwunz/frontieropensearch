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
const { IDLE, LISTENING } = ChromeUtils.importESModule(
  "resource:///modules/FOSVoiceSession.sys.mjs"
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

  const engine = {
    async run(request) {
      counts.requests.push(request);
      return { text: transcript };
    },
    async terminate() {},
  };

  voice().useBackend({
    recorder,
    listFiles: async () => (weights ? [{ path: "model.onnx" }] : []),
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

function talkKey(type) {
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

/** Let it go, and wait until the turn is over. */
async function releaseTalkKey() {
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
