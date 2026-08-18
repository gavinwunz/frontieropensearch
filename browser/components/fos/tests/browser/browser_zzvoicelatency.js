/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * The ASR spike, as a measurement rather than an argument.
 *
 * `IDEAS.md` (run 23) settled what the voice path's numbers have to beat — a
 * turn feels natural inside ~1s of the end of the utterance and tolerable to
 * 2s, given the live transcript echo the command bar already provides — and
 * settled that the knob deciding whether they can is the backend.
 *
 * **The backend is a two-axis knob, and run 26 only ever turned one axis.**
 * This file used to pass `device` and no `backend`, which is why both arms
 * failed identically with "Unable to get the ML engine from Remote Settings":
 * `MLEngineChild` reads `opts.backend || BACKENDS.onnx`, so an unnamed backend
 * is the *wasm* backend, and the wasm runtime is a Remote Settings attachment
 * that the mochitest harness has no populated database for and no packaged
 * dump to fall back on. The device axis never came into it.
 *
 * The tree has a second ONNX backend that is not wasm at all. `onnx-native`
 * runs on `libonnxruntime.so`, which `./mach bootstrap` pulls as an ordinary
 * build toolchain and which is already packaged into `dist/bin` — so it is a
 * build dependency rather than a runtime download, `WASM_BACKENDS` excludes it,
 * and `getWasmArrayBuffer` is never called for it. That is the arm this fork
 * can actually ship offline, and it is measured first below. It is CPU-only:
 * `ONNXPipeline` hands Transformers.js `supportedDevices: ["cpu"]` for it, so
 * there is no native GPU arm to measure however the blocklist is set.
 *
 * The wasm arms are kept because they are the comparison that decides whether
 * shipping the offline runtime costs anything. They need Remote Settings, so
 * they report UNAVAILABLE in a harness rather than failing the run.
 *
 * **This measures latency, not accuracy.** The audio below is synthetic, so
 * the transcript is meaningless and is not checked. That is sound for the
 * question being asked: Whisper's encoder runs over a fixed 30-second mel
 * window whatever it is given, so encode time does not vary with what was
 * said, and the part that does vary — how many tokens come out — is held at a
 * command's length by `max_new_tokens`. Accuracy needs real speech and is a
 * separate exercise.
 *
 * **The weights come off a local hub, and they have to.** mochitest aborts the
 * whole process on any non-local connection — "FATAL ERROR: Non-local network
 * connections are disabled" — which is what killed run27 *after* the native
 * runtime had loaded cleanly. The tree's supported answer is the local hub
 * hook, which serves `$MOZ_ML_LOCAL_DIR/onnx-models` over localhost and exports
 * `MOZ_MODELS_HUB`. This file refuses to run without it rather than reaching
 * for the network and taking the browser down with it.
 *
 * Off unless `FOS_MEASURE_ASR` is set, the same gate `browser_zdemoflow.js`
 * uses for its screenshots: this is minutes of inference, which does not belong
 * in the suite.
 *
 *   agent/jobs/fetch-whisper.sh          # once, ~43MB, outside the repo
 *   FOS_MEASURE_ASR=1 MOZ_ML_LOCAL_DIR=/data/ml-models \
 *     ./mach mochitest --keep-open=false \
 *     --hooks toolkit/components/ml/tests/tools/hooks_local_hub.py \
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
 * @param {string} backend "onnx-native" (packaged, offline) or "onnx" (wasm).
 * @param {string} device "gpu" or "cpu".
 * @param {number[]} durations Utterance lengths in seconds to time.
 */
async function measure(backend, device, durations) {
  const label = `${backend}/${device}`;
  const options = {
    taskName: "automatic-speech-recognition",
    modelId: "onnx-community/whisper-tiny",
    modelHubRootUrl: Services.env.get("MOZ_MODELS_HUB"),
    modelHubUrlTemplate: "{model}/{revision}",
    modelRevision: "main",
    dtype: "q8",
    backend,
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
    info(`##### ASR ${label} UNAVAILABLE ${error}`);
    return;
  }
  const loadMs = ChromeUtils.now() - loadStart;
  info(`##### ASR ${label} load ${round(loadMs)}ms`);

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
        `##### ASR ${label} ${seconds}s audio: ` +
          `median ${round(median(runs))}ms  ` +
          `min ${round(Math.min(...runs))}ms  ` +
          `max ${round(Math.max(...runs))}ms`
      );
      ok(true, `${label} transcribed ${seconds}s of audio ${ITERATIONS} times`);
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

  // Without a local hub the model fetch is a non-local connection, and under
  // mochitest that is fatal to the process rather than an error this file
  // could report. Refuse up front and say how to fix it: a skipped measurement
  // is a result, a killed browser is thirty lines of log and no result.
  if (!Services.env.get("MOZ_MODELS_HUB")) {
    ok(
      true,
      "skipped: no MOZ_MODELS_HUB. Run agent/jobs/fetch-whisper.sh, then " +
        "pass --hooks toolkit/components/ml/tests/tools/hooks_local_hub.py " +
        "with MOZ_ML_LOCAL_DIR set."
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

  // The offline arm first: this is the one the fork can ship, so if it clears
  // the budget the wasm numbers are a curiosity rather than a decision.
  await measure("onnx-native", "cpu", durations);

  // The wasm arms, for comparison. Both need the runtime from Remote Settings.
  await measure("onnx", "gpu", durations);
  await measure("onnx", "cpu", durations);
});
