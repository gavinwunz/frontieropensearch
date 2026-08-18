/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * One voice turn, with nothing replaced.
 *
 * `browser_voice.js` covers the shell's decisions with a test double in place
 * of the microphone and the model, which is how it runs in milliseconds and
 * how it can make a recording too quiet on purpose. What it cannot tell you is
 * whether the two real things work at all: whether `getUserMedia` on a chrome
 * window really opens without a prompt, whether `MediaRecorder` and
 * `decodeAudioData` really hand back mono samples at Whisper's rate, and
 * whether the packaged `onnx-native` runtime really answers inside a turn's
 * deadline. Every one of those is a claim this fork makes in `GRAMMAR.md` §8
 * and none of them is testable with a double.
 *
 * So this file drives the whole stack: the talk key, the device, the recorder,
 * the decode, the engine, the adapter and the command bar.
 *
 * **What it does not assert is the words.** The device is Gecko's fake audio
 * source, which is a tone rather than speech, so the honest outcome is either
 * a transcript the adapter refuses as a hallucination or one that does not
 * parse. Both are *passes*: what is under test is that a turn completes, that
 * the microphone closes, and that the transcript came from the model rather
 * than from nowhere. Accuracy needs a person and a room, and is not something
 * an automated run can claim.
 *
 * Off unless `FOS_VOICE_E2E` is set, the same gate the latency measurement
 * uses, because it downloads 45MB and then runs inference. `agent/jobs/run30.sh`
 * is the working invocation — it needs the local hub, since mochitest kills the
 * process on a non-local connection.
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

requestLongerTimeout(20);

/** How long to hold the key. A command's worth of audio. */
const UTTERANCE_MS = 2000;

function reportText(win) {
  const report = win.document.querySelector(".fos-report");
  return report && !report.hidden ? report.textContent : "";
}

add_task(async function test_one_real_turn_end_to_end() {
  if (!Services.env.get("FOS_VOICE_E2E")) {
    ok(true, "skipped: set FOS_VOICE_E2E to drive a real device and model");
    return;
  }
  if (!Services.env.get("MOZ_MODELS_HUB")) {
    // Without it the weights come off the network, and a non-local connection
    // under mochitest is fatal to the process rather than a failure this file
    // could report. Refusing up front is a result; a killed browser is not.
    ok(true, "skipped: no MOZ_MODELS_HUB. See agent/jobs/run30.sh");
    return;
  }

  await SpecialPowers.pushPrefEnv({
    // Gecko's own fake device. There is no microphone on the machine this runs
    // on, and a real one would make the run depend on a room.
    set: [
      ["media.navigator.streams.fake", true],
      ["media.navigator.permission.disabled", true],
    ],
  });

  const win = await BrowserTestUtils.openNewBrowserWindow();
  await SimpleTest.promiseFocus(win);
  const voice = FOSVoiceInput.forWindow(win);
  const bar = FOSCommandBar.forWindow(win);

  try {
    // First press: the weights are not in a fresh profile, so this is the
    // download step rather than a turn. It is exactly what a new user's first
    // press does, which makes it worth driving rather than setting up around.
    EventUtils.synthesizeKey(`KEY_${TALK_KEY}`, { type: "keydown" }, win);
    EventUtils.synthesizeKey(`KEY_${TALK_KEY}`, { type: "keyup" }, win);
    info(`##### VOICE first press: ${reportText(win)}`);

    await TestUtils.waitForCondition(
      () => reportText(win).includes("ready"),
      "the speech model downloads and loads",
      500,
      600
    );
    info(`##### VOICE model ready: ${reportText(win)}`);
    bar.dismissNotice();

    // Now the turn itself, on a resident engine — which is the state every
    // press after the first one is in.
    const started = ChromeUtils.now();
    EventUtils.synthesizeKey(`KEY_${TALK_KEY}`, { type: "keydown" }, win);
    await TestUtils.waitForCondition(
      () => voice.state === LISTENING,
      "the device opens and the turn arms"
    );
    const armedMs = ChromeUtils.now() - started;
    info(`##### VOICE armed in ${Math.round(armedMs)}ms`);

    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, UTTERANCE_MS));

    const released = ChromeUtils.now();
    EventUtils.synthesizeKey(`KEY_${TALK_KEY}`, { type: "keyup" }, win);
    await TestUtils.waitForCondition(
      () => voice.state === IDLE,
      "the turn completes",
      500,
      120
    );
    const turnMs = ChromeUtils.now() - released;

    info(
      `##### VOICE ${Math.round(UTTERANCE_MS)}ms of audio answered in ` +
        `${Math.round(turnMs)}ms — transcript "${voice.lastHeard}", ` +
        `report "${reportText(win)}"`
    );

    Assert.notEqual(
      voice.lastHeard,
      "",
      "the packaged runtime answered: the transcript came from the model"
    );
    Assert.equal(voice.state, IDLE, "and the turn ended rather than hanging");
    Assert.less(
      turnMs,
      15000,
      "inside the deadline the transcribing stage carries"
    );
  } finally {
    voice.destroy();
    await BrowserTestUtils.closeWindow(win);
  }
});
