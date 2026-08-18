/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * The ASR spike, as a measurement rather than an argument.
 *
 * `IDEAS.md` (run 23) settled what the voice path's numbers have to beat — a
 * turn feels natural inside ~1s of the end of the utterance and tolerable to
 * 2s, given the live transcript echo the command bar already provides — and
 * settled that the knob deciding whether they can is the backend. The tree
 * ships both: `ort.webgpu.mjs` is packaged, `ONNXPipeline` takes
 * `config.device`, and `ensurePipelineIsReady` falls back to CPU on its own
 * when the GPU is unsupported. What was left was the part no amount of reading
 * settles, which is what this hardware actually does.
 *
 * **This measures latency, not accuracy.** The audio below is synthetic, so
 * the transcript is meaningless and is not checked. That is sound for the
 * question being asked: Whisper's encoder runs over a fixed 30-second mel
 * window whatever it is given, so encode time does not vary with what was
 * said, and the part that does vary — how many tokens come out — is held at a
 * command's length by `max_new_tokens`. Accuracy needs real speech and is a
 * separate exercise.
 *
 * Off unless `FOS_MEASURE_ASR` is set, the same gate `browser_zdemoflow.js`
 * uses for its screenshots: this downloads ~75MB on its first run and takes
 * minutes, neither of which belongs in the suite.
 *
 *   FOS_MEASURE_ASR=1 ./mach mochitest --keep-open=false \
 *     browser/components/fos/tests/browser/browser_zzvoicelatency.js
 *
 * Read the results by grepping the log for `##### ASR`.
 */

const { createEngine } = ChromeUtils.importESModule(
  "chrome://global/content/ml/EngineProcess.sys.mjs"
);

requestLongerTimeout(20);

/** Whisper's input rate, and the only one its feature extractor accepts. */
const SAMPLE_RATE = 16000;

/** How many timed runs per device, after the untimed warm-up. */
const ITERATIONS = 5;

/**
 * A command's worth of transcript. Long enough for the longest thing the
 * grammar can produce in one utterance and short enough that a hallucinated
 * ramble cannot dominate the timing.
 */
const MAX_NEW_TOKENS = 24;

/**
 * Synthetic audio with speech's gross shape: a few harmonics of a voice-range
 * fundamental, syllable-rate amplitude modulation, and a little noise. It is
 * not speech and is not meant to be — see the file comment. What it has to be
 * is the right length, the right rate and the right dynamic range, so that the
 * feature extractor does the same work it would do on a real utterance.
 *
 * @param {number} seconds
 * @returns {Float32Array}
 */
function utterance(seconds) {
  const count = Math.round(seconds * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    // A 130Hz fundamental with two harmonics: an ordinary speaking voice.
    const tone =
      Math.sin(2 * Math.PI * 130 * t) +
      0.5 * Math.sin(2 * Math.PI * 260 * t) +
      0.25 * Math.sin(2 * Math.PI * 390 * t);
    // Syllables at about four a second, which is conversational rate.
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    samples[i] = 0.2 * envelope * tone + 0.01 * (Math.random() * 2 - 1);
  }
  return samples;
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** @param {number} ms */
function round(ms) {
  return Math.round(ms * 10) / 10;
}

/**
 * Load `whisper-tiny` on one backend and time it.
 *
 * The load is reported separately from the runs because they are different
 * costs to the user: the load happens once and can be paid before the first
 * press — arming the turn is exactly the moment for it — while every run is
 * paid inside the budget, after the key comes up.
 *
 * @param {string} device "gpu" or "cpu".
 * @param {number[]} durations Utterance lengths in seconds to time.
 */
async function measure(device, durations) {
  const options = {
    taskName: "automatic-speech-recognition",
    modelId: "onnx-community/whisper-tiny",
    modelHubUrlTemplate: "{model}/{revision}",
    modelRevision: "main",
    dtype: "q8",
    device,
    timeoutMS: -1,
  };

  let engine;
  const loadStart = ChromeUtils.now();
  try {
    engine = await createEngine(options);
  } catch (error) {
    // A backend this machine does not have is a result, not a failure: it is
    // the answer to "which default can this fork ship".
    info(`##### ASR ${device} UNAVAILABLE ${error}`);
    return;
  }
  const loadMs = ChromeUtils.now() - loadStart;
  info(`##### ASR ${device} load ${round(loadMs)}ms`);

  try {
    for (const seconds of durations) {
      const args = [utterance(seconds)];
      const request = {
        args,
        options: {
          language: "en",
          task: "transcribe",
          max_new_tokens: MAX_NEW_TOKENS,
        },
      };

      // One untimed run. The first inference on a fresh session pays for
      // shader compilation on the GPU path and for warming the allocator on
      // the CPU one, and neither is a cost the user pays per utterance.
      await engine.run(request);

      const runs = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = ChromeUtils.now();
        await engine.run(request);
        runs.push(ChromeUtils.now() - start);
      }

      info(
        `##### ASR ${device} ${seconds}s audio: ` +
          `median ${round(median(runs))}ms  ` +
          `min ${round(Math.min(...runs))}ms  ` +
          `max ${round(Math.max(...runs))}ms`
      );
      ok(
        true,
        `${device} transcribed ${seconds}s of audio ${ITERATIONS} times`
      );
    }
  } finally {
    await engine.terminate();
  }
}

add_task(async function measure_asr_latency() {
  if (!Services.env.get("FOS_MEASURE_ASR")) {
    ok(
      true,
      "skipped: set FOS_MEASURE_ASR to measure whisper-tiny on this machine"
    );
    return;
  }

  // The blocklist is what stands between this machine's driver and the WebGPU
  // path, and the question here is what the hardware can do rather than what
  // upstream is willing to ship to it. Nothing in the fork turns this on.
  await SpecialPowers.pushPrefEnv({
    set: [["gfx.webgpu.ignore-blocklist", true]],
  });

  // 1.5s is a command — "enter cap, branch" said at speed. 3s is the longest
  // thing the grammar allows in one utterance, since free text is terminal.
  // Whisper pads both to the same 30s window, so if these two differ the
  // difference is decoding, which is the only part a shorter grammar helps.
  const durations = [1.5, 3];

  await measure("gpu", durations);
  await measure("cpu", durations);
});
