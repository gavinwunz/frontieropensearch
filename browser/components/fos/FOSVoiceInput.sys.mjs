/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The voice front end's shell: the microphone, the model and the key.
 *
 * `FOSVoiceSession` is the turn and decides everything the user sees;
 * `FOSVoiceTranscript` decides what counts as speech. Neither can open a
 * device or run a model, which is deliberate — it is what lets both be tested
 * under `node --test`. This file is the remainder, and it is kept to the three
 * things only Gecko can do:
 *
 *   1. Hear the talk key, including while the focus is in a page.
 *   2. Record the utterance and hand back mono 16kHz samples.
 *   3. Run `whisper-tiny` on them, offline, and report the transcript.
 *
 * It contains no grammar. What comes out of the model is handed to the command
 * bar as a line of text, which is exactly what the keyboard hands it, and from
 * there the parser, the marks and the action table cannot tell the two apart —
 * `GRAMMAR.md` §5's one code path, honoured by having nothing else to honour it
 * with.
 *
 * **The key is F4, held.** A press is the whole turn: the microphone is open
 * while the key is down and closes when it comes up. F4 is unbound in this
 * browser, which is the same reason F2 carries the Field, and it is a key that
 * produces no text, so a turn cannot begin by typing one. There is no wake word
 * yet — `GRAMMAR.md` §8 has why push-to-talk comes first, and a wake word
 * arrives on this same path when it arrives.
 *
 * **Shift+F4 latches the same turn**, so it starts on one press and ends on the
 * next with nothing held in between. This is a second gesture and not a second
 * mode: it is one flag in `FOSVoiceSession`, it ends in the same transcript, and
 * every other way a turn can end works unchanged. It exists because holding a
 * key is exactly what tremor, arthritis, carpal tunnel and fatigue make
 * expensive, and `GRAMMAR.md` §5 promises no separate accessibility mode — a
 * promise a hands-free path with one hand-intensive gesture was not keeping.
 * Shift is reachable one-fingered through the platform's own sticky keys, which
 * is a mechanism these users already have turned on. `IDEAS.md` (run 30) has
 * the sources.
 *
 * **Tapping F4 latches it too**, with no modifier at all, which is what a user
 * with one reliable finger would have chosen in the first place. It was held
 * back for three runs on a real objection: a mis-tap would open the microphone
 * for the whole 30-second deadline. What unblocked it was noticing that the
 * objection was never about the tap — shift+F4 has the identical exposure — but
 * about a latched microphone being bounded only by a clock. `FOSVoiceSession`
 * now bounds it by what it hears as well, so a mis-tap costs six seconds of
 * silence, and the tap costs nothing to offer on top of that. `IDEAS.md`
 * (run 40) has the measurement and the sources.
 *
 * **The transcript writes the command bar.** The bar opens on the press if it
 * was closed, so the words land in the field the user would have typed them
 * into and the parse is in front of them before anything runs. That is the echo
 * §8 calls the latency budget's second half, and it costs no second surface.
 *
 * **The model is `onnx-native`, on the CPU.** That backend runs on
 * `libonnxruntime.so`, which `./mach bootstrap` places in `dist/bin` as an
 * ordinary build dependency, so inference needs no network and touches no
 * Mozilla service. Measured on this hardware it transcribes a command in a
 * median 324ms (`agent/jobs/run29.sh`), inside the ~1s a voice turn has to feel
 * natural in. The wasm backend would have been a Remote Settings download and
 * is not used. See `GRAMMAR.md` §8's last rule.
 *
 * **The weights are the one thing that is fetched, once, and visibly.** They
 * are ~45MB and cannot be a build dependency of a public git tree. A press with
 * no weights present therefore does not open a microphone that fails with an
 * error about a fetch nobody asked for: it says what it is downloading and how
 * big it is, downloads it once into the profile's model cache, and works from
 * then on with no network at all.
 */

import {
  ARMING,
  IDLE,
  LISTENING,
  NOTICE_NOTHING_HEARD,
  NOTICE_TOO_QUIET,
  NOTICE_TOO_SHORT,
  NOTICE_UNAVAILABLE,
  TRANSCRIBING,
  VoiceSession,
} from "./FOSVoiceSession.sys.mjs";
import { MIN_RMS, audioIsSpeech } from "./FOSVoiceTranscript.sys.mjs";
import { ensureStylesheet } from "./FOSChrome.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-voice.css";

/** The talk key. Held on its own; latched with shift. */
export const TALK_KEY = "F4";

/**
 * The model, and the shape of the request it is given.
 *
 * `whisper-tiny` at 8-bit is the smallest thing that transcribes a command
 * reliably, and its size is what makes the download a one-off annoyance rather
 * than a reason not to ship a voice path at all. `max_new_tokens` is a
 * command's worth of words: free text is terminal in the grammar
 * (`FOSGrammar`), so one utterance cannot legitimately be longer, and capping
 * it is what stops a hallucinated ramble costing seconds of decode.
 */
export const MODEL_ID = "onnx-community/whisper-tiny";
export const MODEL_REVISION = "main";
export const TASK_NAME = "automatic-speech-recognition";
export const BACKEND = "onnx-native";
export const DTYPE = "q8";
const MAX_NEW_TOKENS = 24;

/**
 * How the level is sampled while a recording runs.
 *
 * 100ms is chosen against what it is measuring rather than as a round number:
 * the shortest gap that has to *not* register as the end of an utterance is the
 * pause between two words, and the shortest that has to register as speech is a
 * single word at speed (~250ms, `MIN_UTTERANCE_MS`). Ten polls a second puts at
 * least two inside the shorter of those while costing an order of magnitude
 * less main-thread time than a frame does.
 *
 * 2048 samples is ~43ms at 48kHz, which is longer than a glottal pulse and
 * shorter than a syllable — an RMS over it is a measure of the voice rather
 * than of where in the waveform the poll happened to land.
 */
const LEVEL_POLL_MS = 100;
const LEVEL_FFT_SIZE = 2048;

/**
 * How long to let the audio graph start before giving up on it.
 *
 * An `AudioContext` reaches `running` asynchronously, so its state at
 * construction says nothing — reading it there would report "no monitor" on a
 * perfectly healthy machine. What it cannot do is take half a second, so a
 * graph still not running by then is one that never will: a machine with no
 * audio output device reports `destination.maxChannelCount === 0` and stays
 * suspended forever, which is exactly the state of the box this is built on.
 *
 * Well inside the six-second initial-silence bound, so the turn is put back on
 * the model's window long before that bound could act on a silence nothing was
 * measuring.
 */
const LEVEL_START_GRACE_MS = 500;

/**
 * Where the weights come from the one time they are fetched.
 *
 * Hugging Face rather than Mozilla's mirror, because this fork does not present
 * itself as Firefox and should not lean on Firefox's infrastructure for a file
 * it can get from the model's own home. `MOZ_MODELS_HUB` overrides it, which is
 * how `agent/jobs/run29.sh` serves the same weights off localhost with no
 * network at all.
 */
const HUB_ROOT = "https://huggingface.co/";
const HUB_TEMPLATE = "{model}/resolve/{revision}";
const LOCAL_HUB_TEMPLATE = "{model}/{revision}";

/** Roughly what the user is agreeing to download, for the one line that says so. */
const WEIGHTS_MB = 45;

/** What each notice code says. The session owns the code, this owns the words. */
const NOTICES = {
  [NOTICE_TOO_SHORT]: "Too short to hear — hold the key down while you speak.",
  [NOTICE_TOO_QUIET]: "Too quiet to be sure that was speech. Try once more.",
  [NOTICE_NOTHING_HEARD]: "Nothing heard.",
  [NOTICE_UNAVAILABLE]: "The microphone or the speech model is unavailable.",
};

/**
 * What a latched turn says instead, where the words above are advice about a
 * gesture the user deliberately did not use.
 *
 * Only "too short" needs it, and it needs it because the code is reachable two
 * ways. A key that came up before the microphone opened is held-only — a
 * latched turn stopped that early is a cancel and says nothing at all — but the
 * *audio gate* raises the same code for a recording too brief to be a word, and
 * that one a latched turn reaches by pressing twice in quick succession. Telling
 * that user to hold a key down is advice for the other gesture.
 */
const LATCHED_NOTICES = {
  [NOTICE_TOO_SHORT]: `Too short to hear — speak, then press ${TALK_KEY} to stop.`,
};

/** What the indicator says at each stage. */
const STAGES = {
  [ARMING]: "Getting ready…",
  [LISTENING]: "Listening",
  [TRANSCRIBING]: "Working on that…",
};

/**
 * What a latched turn adds to the indicator, which is how to end it.
 *
 * A held turn needs no such line: the user's own finger is the answer to "how
 * do I stop this". A latched turn has an open microphone with nobody touching
 * anything, and this indicator is the only signal in the browser that it is
 * open at all (see `#indicate`), so the gesture that closes it belongs here
 * rather than in documentation nobody reads mid-utterance. Hands-free dictation
 * surfaces that latch put the stop control on the same indicator for the same
 * reason.
 *
 * It is one string and not per stage, and the stylesheet rather than this file
 * decides when it is legible, because the indicator must not change size in the
 * middle of a turn — the same reason the dot is quieted rather than hidden.
 */
const LATCHED_HINT = `— press ${TALK_KEY} to stop`;

/** One voice front end per chrome window. */
const byWindow = new WeakMap();

/**
 * The microphone, as the two calls the turn actually needs.
 *
 * Recording through `MediaRecorder` and decoding once at the end, rather than
 * draining an `AudioWorklet` frame by frame, is chosen for what it does to the
 * chrome process: the capture costs the main thread nothing while the user is
 * speaking, which is the window in which jank would be visible, and the decode
 * lands after the key is up where there is already a model running. Decoding
 * into an `OfflineAudioContext` built at 16kHz also resamples the device's rate
 * to Whisper's for free, and the shape check afterwards is what makes sure it
 * really did.
 */
class MicRecorder {
  #window;
  #stream = null;
  #recorder = null;
  #chunks = [];
  #levelContext = null;
  #levelTimer = 0;
  #monitoring = false;

  /**
   * Whether the level monitor is actually delivering, which the turn has to ask
   * before it trusts silence to mean anything.
   *
   * @returns {boolean}
   */
  get monitoring() {
    return this.#monitoring;
  }

  /**
   * Called with `true` when the level crosses the speech floor and `false` when
   * it falls back below, and never twice with the same answer. What that means
   * for the turn is entirely `VoiceSession`'s to decide — this reports the
   * room, not a verdict.
   *
   * @type {?Function}
   */
  onLevel = null;

  constructor(window) {
    this.#window = window;
  }

  /**
   * Open the device and start recording.
   *
   * The constraints ask for the platform's own cleanup — one channel, echo
   * cancellation, noise suppression, gain control. That is not audio taste: the
   * audio gate in `FOSVoiceTranscript` is what keeps a phantom command out of
   * the Context Engine, and it works on level and shape, so the cleaner the
   * signal reaching it the fewer real utterances it has to refuse.
   */
  async start() {
    this.#chunks = [];
    this.#stream = await this.#window.navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.#recorder = new this.#window.MediaRecorder(this.#stream);
    this.#recorder.addEventListener("dataavailable", event => {
      if (event.data?.size) {
        this.#chunks.push(event.data);
      }
    });
    this.#recorder.start();
    this.#monitoring = this.#watchLevel();
  }

  /**
   * Watch the level while the recording runs, for the two bounds a latched turn
   * has that a held one does not (`FOSVoiceSession`).
   *
   * This is the one thing the class comment above says it does not do, so it is
   * worth being exact about how much of that is given up. The rejected design
   * was an `AudioWorklet` drained frame by frame, which is per-frame JS on the
   * audio path for the whole utterance. An `AnalyserNode` polled ten times a
   * second is a different size of thing: the node keeps its own ring buffer in
   * C++ whether or not anybody reads it, and the cost here is one 2048-sample
   * copy and a sum every 100ms — about 0.02ms of main-thread work per poll.
   * Nothing is decoded, nothing is retained, and the recording still reaches
   * the model through `MediaRecorder` exactly as before.
   *
   * The analyser is deliberately not connected onward to a destination. It is
   * fed by a live `MediaStreamAudioSourceNode`, which pulls on its own, and
   * routing a microphone to the speakers is how a browser gets feedback.
   *
   * The floor is `FOSVoiceTranscript`'s `MIN_RMS` and not a number of this
   * file's own, so the bound and the audio gate cannot disagree about what
   * counts as speech. See `VoiceSession.heard`.
   *
   * **A graph that is not running must never be mistaken for a quiet room**,
   * and this is the one failure here with teeth. A suspended `AudioContext`
   * reads a flat zero forever, which is exactly what silence reads, so a turn
   * that trusted it would end six seconds into somebody's sentence and tell
   * them nothing was heard — worse than not having the bound at all.
   *
   * Whether the graph is running therefore cannot be answered at construction,
   * and not only because the state is reached asynchronously. A machine with no
   * audio output device — `destination.maxChannelCount === 0` — never leaves
   * `suspended` at all, and needing an *output* device to measure an *input*
   * one is a Web Audio fact rather than a choice. So the poll decides: it waits
   * `LEVEL_START_GRACE_MS` for the graph to start, and if it has not, reports
   * speech once and stops looking. That single report is what lifts the silence
   * bounds and puts the turn back on the model's own window — the design that
   * shipped before those bounds existed, which is the right place for a turn
   * with no level information to land.
   *
   * @returns {boolean} Whether a monitor exists to report anything at all.
   */
  #watchLevel() {
    let speaking = false;
    let ran = false;
    let waited = 0;
    try {
      const context = new this.#window.AudioContext();
      this.#levelContext = context;
      const source = context.createMediaStreamSource(this.#stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = LEVEL_FFT_SIZE;
      source.connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      this.#levelTimer = this.#window.setInterval(() => {
        if (context.state !== "running") {
          waited += LEVEL_POLL_MS;
          if (!ran && waited < LEVEL_START_GRACE_MS) {
            return;
          }
          this.#stopWatchingLevel();
          this.onLevel?.(true);
          return;
        }
        ran = true;
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (const sample of frame) {
          sum += sample * sample;
        }
        const loud = Math.sqrt(sum / frame.length) >= MIN_RMS;
        if (loud !== speaking) {
          speaking = loud;
          this.onLevel?.(loud);
        }
      }, LEVEL_POLL_MS);
      return true;
    } catch (error) {
      // A turn without a level monitor is the turn that shipped before this
      // existed: bounded by its deadlines and by the key, and correct, just
      // less considerate. It is not worth failing a recording over.
      console.error(error);
      return false;
    }
  }

  #stopWatchingLevel() {
    if (this.#levelTimer) {
      this.#window.clearInterval(this.#levelTimer);
      this.#levelTimer = 0;
    }
    const context = this.#levelContext;
    this.#levelContext = null;
    context?.close?.().catch?.(console.error);
  }

  /**
   * Stop, and hand back what was said.
   *
   * @returns {Promise<{samples: Float32Array, sampleRate: number}>}
   */
  async stop() {
    if (!this.#recorder) {
      return { samples: new Float32Array(0), sampleRate: 0 };
    }
    const recorder = this.#recorder;
    const stopped = new Promise(resolve => {
      recorder.addEventListener("stop", resolve, { once: true });
    });
    if (recorder.state !== "inactive") {
      recorder.stop();
      await stopped;
    }
    const chunks = this.#chunks;
    this.#release();

    if (!chunks.length) {
      // A press and release inside one media-recorder frame produces no blob
      // at all. That is a tap rather than a turn, and the audio gate is where
      // it is refused, so it is reported as an empty recording rather than as
      // an error.
      return { samples: new Float32Array(0), sampleRate: 0 };
    }

    const blob = new this.#window.Blob(chunks, { type: recorder.mimeType });
    const buffer = await blob.arrayBuffer();
    const context = new this.#window.OfflineAudioContext(1, 1, 16000);
    const decoded = await context.decodeAudioData(buffer);
    return {
      samples: decoded.getChannelData(0),
      sampleRate: decoded.sampleRate,
    };
  }

  /** Throw the recording away and close the device now. */
  abort() {
    try {
      if (this.#recorder && this.#recorder.state !== "inactive") {
        this.#recorder.stop();
      }
    } catch (error) {
      console.error(error);
    }
    this.#chunks = [];
    this.#release();
  }

  #release() {
    this.#stopWatchingLevel();
    this.#recorder = null;
    for (const track of this.#stream?.getTracks() ?? []) {
      track.stop();
    }
    this.#stream = null;
  }
}

/**
 * Pull the words out of whatever the pipeline returned.
 *
 * Transformers.js answers an ASR request with `{text}`, and with an array of
 * those when it is asked for timestamps. Neither shape is worth asserting on
 * here: an engine that answers with something else should cost the user one
 * refused turn, not a broken microphone.
 *
 * @param {any} result
 * @returns {string}
 */
function transcriptOf(result) {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result)) {
    return result.map(transcriptOf).filter(Boolean).join(" ");
  }
  return typeof result?.text === "string" ? result.text : "";
}

/**
 * A window's push-to-talk.
 */
export class FOSVoiceInput {
  /**
   * The voice front end for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSVoiceInput}
   */
  static forWindow(window) {
    let voice = byWindow.get(window);
    if (!voice) {
      voice = new FOSVoiceInput(window);
      byWindow.set(window, voice);
    }
    return voice;
  }

  #window;
  #bar = null;
  #session = new VoiceSession();
  #recorder;
  #engine = null;
  #engineReady = null;
  #downloading = false;
  #indicator = null;
  #stage = null;
  #deadlineTimer = 0;
  /**
   * Bumped whenever a turn is abandoned. Everything that comes back from an
   * await — the device opening, the model answering — checks it before it acts,
   * so a cancelled turn cannot be completed by work that was already in flight.
   */
  #turn = 0;
  /** Whether this turn opened the command bar, and so owes it a close. */
  #openedBar = false;
  /** Test seam: what makes engines. Replaced wholesale, never patched. */
  #createEngine = null;
  #listFiles = null;
  /** The last thing the model said, before the adapter normalised it. */
  #heard = "";

  constructor(window) {
    this.#window = window;
    this.#recorder = new MicRecorder(window);
    this.#watchRecorderLevel();
  }

  /**
   * Bind the talk key and take the command bar as the surface to speak into.
   *
   * No verb is registered. Voice is a second front end onto the grammar rather
   * than an entry in it — `GRAMMAR.md` §5 — so there is nothing here for the
   * action table to learn, and a spoken "voice" command would be the one verb
   * that could not be reached by the modality it names.
   *
   * @param {object} bar The window's `FOSCommandBar`.
   * @returns {FOSVoiceInput} This front end.
   */
  wire(bar) {
    if (this.#bar) {
      return this;
    }
    this.#bar = bar;
    const window = this.#window;
    // Capturing, and on the window, because a key pressed while the focus is
    // in a page is not delivered here directly: the content process replies
    // with the event and `BrowserParent` re-dispatches it at the `<browser>`,
    // from where it reaches the window. A listener on the input or the bar
    // would hear the talk key only when the bar already had the focus, which
    // is the one moment a voice user has not got to yet.
    window.addEventListener("keydown", this, { capture: true });
    window.addEventListener("keyup", this, { capture: true });
    // Losing the window ends the turn. See `FOSVoiceSession.blurred` — this is
    // the ordinary way a key-up goes missing, and the one that leaves a
    // push-to-talk microphone open.
    window.addEventListener("deactivate", this);
    window.addEventListener("unload", this, { once: true });
    return this;
  }

  /** @returns {string} The turn's stage, for tests and for the indicator. */
  get state() {
    return this.#session.state;
  }

  /**
   * What the model last returned, raw.
   *
   * Nothing in the browser reads this. It exists for the end-to-end run in
   * `browser_zzvoiceturn.js`, which drives a real device through a real model
   * and has no other way to tell "the engine answered and the adapter refused
   * the answer" — the honest outcome for a room with nobody in it — from "the
   * engine was never reached".
   *
   * @returns {string}
   */
  get lastHeard() {
    return this.#heard;
  }

  /**
   * Replace the microphone and the model with test doubles.
   *
   * The shell's own decisions — when the microphone opens, when the deadline
   * runs, what the bar is left holding — are the part worth testing in a
   * browser, and none of them should need a device or 45MB of weights to
   * exercise. A recorder is anything with `start`, `stop` and `abort`; an
   * engine factory is anything returning something with `run` and `terminate`.
   *
   * @param {object} doubles
   * @param {object} [doubles.recorder]
   * @param {Function} [doubles.createEngine]
   * @param {Function} [doubles.listFiles] Answers "are the weights here".
   */
  useBackend({ recorder, createEngine, listFiles } = {}) {
    if (recorder) {
      this.#recorder = recorder;
      this.#watchRecorderLevel();
    }
    if (createEngine) {
      this.#createEngine = createEngine;
    }
    if (listFiles) {
      this.#listFiles = listFiles;
    }
    this.#engine = null;
    this.#engineReady = null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
        this.#onKeyDown(event);
        break;
      case "keyup":
        if (event.key === TALK_KEY) {
          this.#releaseKey(event);
        }
        break;
      case "deactivate":
        this.#apply(this.#session.blurred());
        break;
      case "unload":
        this.destroy();
        break;
    }
  }

  /** Close the device, drop the engine and forget the window. */
  destroy() {
    this.#apply(this.#session.cancel());
    this.#clearDeadline();
    const engine = this.#engine;
    this.#engine = null;
    this.#engineReady = null;
    engine?.terminate?.().catch?.(console.error);
  }

  // ---- the key ------------------------------------------------------------

  #onKeyDown(event) {
    if (event.key === TALK_KEY) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        // Auto-repeat is what holding a key produces, and holding the key is
        // the entire gesture. The session ignores a press during a turn as
        // well; this is the cheaper half of the same rule.
        event.repeat
      ) {
        return;
      }
      // Shift is the latch, and it is only ever read at the start of a turn:
      // the press that ends a latched turn ends it whether or not the modifier
      // is down, so a user who latched with shift and reached back for a bare
      // key still stops. The session owns that rule — see `VoiceSession.press`.
      this.#pressedAt = event.timeStamp;
      this.#press({ latch: event.shiftKey });
      return;
    }
    if (!this.#session.active) {
      return;
    }
    if (event.key === "Escape") {
      this.#apply(this.#session.cancel());
      return;
    }
    // Typing wins, but only actual typing: a user reaching for shift or alt has
    // not written anything, and abandoning their utterance for it would make
    // the modifier keys hostile to speak over.
    if (event.key.length === 1 || ["Backspace", "Delete"].includes(event.key)) {
      this.#apply(this.#session.typed());
    }
  }

  /**
   * Whether the turn now ending was latched, for the words it is told in.
   *
   * The session clears its own latch when the turn resets, and a notice is
   * chosen after that — the audio gate's verdict in particular arrives a whole
   * transcode later. So the shell keeps its own copy, taken at the press and
   * read at the notice, which are the two ends of one turn.
   */
  #latchedTurn = false;

  /** The talk key's own keydown timestamp, for telling a tap from a hold. */
  #pressedAt = 0;

  /**
   * The talk key came up.
   *
   * The two event timestamps are what the hold is measured from, rather than
   * two readings of the clock taken inside these handlers. Under load those are
   * not the same number — a handler can run some way after the event it is
   * handling — and the difference lands exactly on the boundary this is used to
   * decide, turning a deliberate hold on a busy machine into a tap.
   *
   * A bare tap latches on the way up rather than at the press, so the wording
   * of any later notice — like the indicator's stop hint, which reads the
   * session directly — has to be settled here too. `#latchedTurn` is only ever
   * turned on: the press that *ends* a latched turn has already cleared
   * `latched` by the time anything reads it, which is the whole reason this
   * field exists rather than a call through to the session.
   *
   * @param {KeyboardEvent} event The talk key's keyup.
   */
  #releaseKey(event) {
    const effect = this.#session.release({
      heldMs: this.#pressedAt ? event.timeStamp - this.#pressedAt : Infinity,
    });
    this.#pressedAt = 0;
    if (this.#session.latched) {
      this.#latchedTurn = true;
    }
    this.#apply(effect);
  }

  #press({ latch = false } = {}) {
    // The bar is the surface the words appear in, so it opens with the press
    // rather than when the transcript lands: a user has to be able to see that
    // this window is listening before they have finished saying anything. The
    // press that *ends* a latched turn finds it already open and opens nothing,
    // so it does not take ownership of a bar the first press already owns.
    if (!this.#bar.isOpen) {
      this.#bar.open();
      this.#openedBar = true;
    }
    const effect = this.#session.press({
      text: this.#bar.input?.value ?? "",
      latch,
    });
    // Read off the session rather than off `latch`, because the press that
    // *ends* a latched turn does not carry the modifier and must not be taken
    // for the start of a held one.
    this.#latchedTurn = this.#session.latched;
    this.#apply(effect);
  }

  // ---- effects ------------------------------------------------------------

  /**
   * Apply one effect from the session, in the order the user experiences it.
   *
   * The deadline is armed first and on purpose: everything below it can await,
   * and a stage whose clock started after its own work would be a stage that
   * could outlive its deadline.
   *
   * @param {object} effect
   */
  #apply(effect) {
    if (!effect) {
      return;
    }
    if (effect.deadline !== null) {
      this.#armDeadline(effect.deadline);
    }
    if (effect.state === IDLE) {
      this.#clearDeadline();
    }
    this.#indicate(effect.state);
    if (effect.capture) {
      this.#applyCapture(effect);
    }
    if (effect.input !== null) {
      this.#setInput(effect.input);
    }
    // Nothing a turn has to say competes with the download, and the reason is
    // §8's last rule. A press that found no weights ends the turn *and* starts
    // the download, and driving it showed both orders happening: the arming
    // failure can land before the download line or the key-up's "too short to
    // hear" can land after it. Either way the download is the true account of
    // why nothing happened, and a complaint about the microphone on top of it
    // is the very line the rule was written against.
    if (effect.notice && !this.#downloading) {
      this.#bar.notify(
        (this.#latchedTurn ? LATCHED_NOTICES[effect.notice] : null) ??
          NOTICES[effect.notice] ??
          NOTICES[NOTICE_UNAVAILABLE]
      );
    }
    if (effect.run !== null) {
      // From here the line is indistinguishable from a typed one, which is the
      // whole design. `run` leaves the bar open when the line does not parse,
      // so a misheard word lands in front of the candidate list rather than
      // being repaired behind the user's back — `GRAMMAR.md` §8.
      this.#openedBar = false;
      this.#bar.run(effect.run);
    } else if (effect.state === IDLE && this.#openedBar) {
      this.#openedBar = false;
      this.#bar.close();
    }
  }

  #applyCapture(effect) {
    if (effect.capture === "start") {
      this.#startCapture();
      return;
    }
    if (effect.state === TRANSCRIBING) {
      this.#finishCapture();
      return;
    }
    // Any other way out of a turn is an abandonment: the device closes now and
    // whatever is in flight is invalidated rather than awaited.
    this.#turn++;
    this.#recorder.abort();
  }

  #setInput(text) {
    const input = this.#bar.input;
    if (input) {
      input.value = text;
      input.dispatchEvent(
        new this.#window.InputEvent("input", { bubbles: true })
      );
    }
  }

  /**
   * Hand the recorder's level reports to the session.
   *
   * Assigned to whatever recorder this front end is currently using rather than
   * passed to the constructor, so a test double is wired the same way the real
   * device is and can drive both bounds by calling `onLevel` directly — no
   * microphone, no audio, and no waiting six seconds to find out what happens
   * when nobody speaks.
   */
  #watchRecorderLevel() {
    this.#recorder.onLevel = loud => {
      this.#apply(loud ? this.#session.heard() : this.#session.quiet());
    };
  }

  #armDeadline(ms) {
    this.#clearDeadline();
    this.#deadlineTimer = this.#window.setTimeout(() => {
      this.#deadlineTimer = 0;
      this.#apply(this.#session.expired());
    }, ms);
  }

  #clearDeadline() {
    if (this.#deadlineTimer) {
      this.#window.clearTimeout(this.#deadlineTimer);
      this.#deadlineTimer = 0;
    }
  }

  // ---- the microphone and the model ---------------------------------------

  /**
   * Open the device and make the model ready, and only then say the turn is
   * armed.
   *
   * The two run together rather than in sequence because they fail differently
   * and cost differently: the device opens in a few milliseconds every time,
   * while the model costs 1.3 seconds the first time and nothing afterwards.
   * Waiting for the model before opening the device would lose the first
   * second of the first utterance of the session, which is the utterance a
   * user judges the feature by.
   */
  async #startCapture() {
    const turn = ++this.#turn;
    try {
      await Promise.all([this.#recorder.start(), this.#ensureEngine()]);
    } catch (error) {
      console.error(error);
      if (turn === this.#turn) {
        this.#apply(this.#session.failed());
      }
      this.#recorder.abort();
      return;
    }
    if (turn !== this.#turn) {
      // Cancelled, or the key came up, while the device was opening.
      this.#recorder.abort();
      return;
    }
    // Whether the turn may trust silence to mean anything is settled here, once,
    // rather than inferred later from reports that never arrived — a monitor
    // that is not running is silent in exactly the way a quiet room is.
    this.#apply(
      this.#session.armed({ monitored: !!this.#recorder.monitoring })
    );
  }

  /** Stop recording, decide whether it was speech, and transcribe it. */
  async #finishCapture() {
    const turn = this.#turn;
    let recording;
    try {
      recording = await this.#recorder.stop();
    } catch (error) {
      console.error(error);
      if (turn === this.#turn) {
        this.#apply(this.#session.failed());
      }
      return;
    }
    if (turn !== this.#turn) {
      return;
    }

    // The gate before the model, not after it. Whisper answers silence with a
    // confident sentence, and a sentence nobody said would be recorded by the
    // Context Engine as a question the user asked.
    const verdict = audioIsSpeech(recording);
    if (!verdict.ok) {
      this.#apply(this.#session.refused(verdict.reason));
      return;
    }

    let text = "";
    try {
      text = await this.#transcribe(recording.samples);
      this.#heard = text;
    } catch (error) {
      console.error(error);
      if (turn === this.#turn) {
        this.#apply(this.#session.failed());
      }
      return;
    }
    if (turn !== this.#turn) {
      return;
    }
    this.#apply(this.#session.final(text));
  }

  async #transcribe(samples) {
    const result = await this.#engine.run({
      args: [samples],
      options: {
        language: "en",
        task: "transcribe",
        max_new_tokens: MAX_NEW_TOKENS,
      },
    });
    return transcriptOf(result);
  }

  /**
   * The engine, created once and kept.
   *
   * It is created at arm time rather than at window init because it is a
   * process, a runtime and 45MB of resident weights, and a window whose user
   * never speaks should pay for none of that. It is kept afterwards because
   * the load is the only part of a turn that misses the budget, and it is paid
   * once per window rather than once per utterance.
   */
  #ensureEngine() {
    if (this.#engine) {
      return Promise.resolve(this.#engine);
    }
    if (!this.#engineReady) {
      this.#engineReady = this.#openEngine().catch(error => {
        // A failed load must not be remembered as a load: the next press has
        // to be able to try again, and after a download it will succeed.
        this.#engineReady = null;
        throw error;
      });
    }
    return this.#engineReady;
  }

  async #openEngine() {
    if (!(await this.#weightsPresent())) {
      // The one fetch this path ever makes, and the user is told about it
      // rather than made to infer it from a broken microphone.
      this.#download();
      throw new Error("the speech model has not been downloaded yet");
    }
    this.#engine = await this.#makeEngine();
    return this.#engine;
  }

  /**
   * Are the weights already in the profile's model cache?
   *
   * Read from the cache rather than from the network, so the answer on a
   * machine with no network is "yes" whenever it is true, and the offline path
   * never depends on being able to ask anyone.
   *
   * This answered "no" on every machine from run 25 until run 38, including one
   * with the weights sitting in its cache, for two reasons that fail
   * identically and are both contradicted by `ModelHub.sys.mjs`'s own JSDoc:
   * `listFiles` resolves to `{files, metadata}` rather than to an array, and
   * the cache keys a model by `hostname/organization/name` rather than by the
   * id configured here. See `FOSEmbeddings.present`, where the same pair was
   * finally caught against a real cache.
   *
   * The cost here was small and entirely invisible, which is why it lasted: a
   * spurious "Downloading the speech model" on the first press of a session,
   * followed by a `createEngine` that read the cache and worked.
   *
   * The double is asked for the real shape rather than a convenient one. A
   * double that returns an array is a second, easier contract, and it is the
   * reason the first mistake went unchallenged for thirteen runs.
   */
  async #weightsPresent() {
    try {
      const listed = await this.#list();
      return !!listed?.files?.length;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  /** The cache query, or the double standing in for it. */
  #list() {
    if (this.#listFiles) {
      return this.#listFiles();
    }
    const { ModelHub } = ChromeUtils.importESModule(
      "chrome://global/content/ml/ModelHub.sys.mjs"
    );
    const options = this.#hub();
    return new ModelHub(options).listFiles({
      taskName: TASK_NAME,
      model: `${URL.parse(options.rootUrl)?.hostname}/${MODEL_ID}`,
      revision: MODEL_REVISION,
    });
  }

  #hub() {
    const local = Services.env.get("MOZ_MODELS_HUB");
    return local
      ? { rootUrl: local, urlTemplate: LOCAL_HUB_TEMPLATE }
      : { rootUrl: HUB_ROOT, urlTemplate: HUB_TEMPLATE };
  }

  /**
   * Fetch the weights once, in the open.
   *
   * `createEngine` is both the download and the load, so the same call that
   * fetches is the one that leaves an engine ready to speak into — there is no
   * second step for the user to find. The press that discovered the weights
   * were missing is what asked for this, which is what makes it a visible
   * one-time step rather than a background fetch.
   */
  #download() {
    if (this.#downloading) {
      return;
    }
    this.#downloading = true;
    this.#bar.notify(
      `Downloading the speech model — about ${WEIGHTS_MB}MB, once. ` +
        `Speech works offline after this.`
    );
    this.#makeEngine(progress => this.#reportProgress(progress))
      .then(engine => {
        this.#engine = engine;
        this.#bar.notify(`Speech model ready. Hold ${TALK_KEY} and speak.`);
      })
      .catch(error => {
        console.error(error);
        this.#bar.notify("The speech model could not be downloaded.");
      })
      .finally(() => {
        this.#downloading = false;
      });
  }

  #reportProgress(progress) {
    const percent = Number(progress?.progress);
    if (!Number.isFinite(percent)) {
      return;
    }
    this.#bar.notify(
      `Downloading the speech model — ${Math.round(percent)}% of about ` +
        `${WEIGHTS_MB}MB, once.`
    );
  }

  async #makeEngine(onProgress = null) {
    if (this.#createEngine) {
      return this.#createEngine(onProgress);
    }
    const { createEngine } = ChromeUtils.importESModule(
      "chrome://global/content/ml/EngineProcess.sys.mjs"
    );
    const { rootUrl, urlTemplate } = this.#hub();
    return createEngine(
      {
        engineId: "fos-voice",
        taskName: TASK_NAME,
        modelId: MODEL_ID,
        modelHubRootUrl: rootUrl,
        modelHubUrlTemplate: urlTemplate,
        modelRevision: MODEL_REVISION,
        dtype: DTYPE,
        backend: BACKEND,
        device: "cpu",
        // The stage deadlines in `FOSVoiceSession` are what bound a turn, and
        // they are the ones the user can see. A second timeout underneath them
        // would end a turn for a reason nothing on screen could explain.
        timeoutMS: -1,
      },
      onProgress
    );
  }

  // ---- the indicator ------------------------------------------------------

  /**
   * Draw the thing the platform does not draw.
   *
   * A chrome window's `getUserMedia` is privileged, so it never prompts, never
   * lights the sharing indicator and never appears in the permissions UI
   * (`GRAMMAR.md` §8). This element is therefore not decoration and not a
   * progress spinner: it is the only signal in the browser that a microphone
   * is open, so it is drawn on the window rather than inside the command bar,
   * and it says which stage the turn is in — which is also the question a voice
   * user actually has, since "is it listening yet" comes before "did it
   * understand".
   *
   * @param {string} state The turn's stage.
   */
  #indicate(state) {
    if (state === IDLE) {
      if (this.#indicator) {
        this.#indicator.hidden = true;
      }
      return;
    }
    this.#buildIndicator();
    this.#indicator.setAttribute("data-stage", state);
    this.#indicator.toggleAttribute("data-latched", this.#session.latched);
    this.#stage.textContent = STAGES[state] ?? "";
    this.#indicator.hidden = false;
  }

  #buildIndicator() {
    if (this.#indicator) {
      return;
    }
    const doc = this.#window.document;
    ensureStylesheet(this.#window, STYLESHEET);

    const indicator = doc.createElementNS(HTML_NS, "div");
    indicator.className = "fos-voice-indicator";
    indicator.hidden = true;
    // Live, because a screen-reader user gets no more warning than anyone else
    // that the microphone is open, and rather less: the dot is the whole signal
    // and it has no text of its own.
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");

    const dot = doc.createElementNS(HTML_NS, "span");
    dot.className = "fos-voice-dot";

    const stage = doc.createElementNS(HTML_NS, "span");
    stage.className = "fos-voice-stage";

    // Always built, shown only for a latched turn, and kept out of the
    // accessibility tree by the same `visibility` the stylesheet uses to hold
    // its space — so a screen-reader user is never offered a control that is
    // not there, and the box never resizes under a sighted one.
    const stop = doc.createElementNS(HTML_NS, "span");
    stop.className = "fos-voice-stop";
    stop.textContent = LATCHED_HINT;

    indicator.append(dot, stage, stop);
    doc.documentElement.appendChild(indicator);

    this.#indicator = indicator;
    this.#stage = stage;
  }

  /** The indicator element, or null before the first turn. Tests read this. */
  get indicator() {
    return this.#indicator;
  }
}
