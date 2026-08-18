/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Push-to-talk, as a state machine with no microphone in it.
 *
 * The surface this drives is the command bar, not a second window: speech is
 * echoed into the same input the keyboard writes into, is parsed by the same
 * parser, and executes the same action table. `IDEAS.md` (run 23) settled why
 * the echo is not optional — a voice turn feels natural inside ~1s of the end
 * of the utterance and tolerable to 2s, and it is the live transcript that buys
 * the second second. It also settled push-to-talk before a wake word: a press
 * makes the microphone's state something the user did rather than something
 * they trust, and costs the wake-word layer nothing, because both end in a
 * transcript handed to `FOSCommandParser`.
 *
 * Everything that decides *what the user sees* lives here rather than in the
 * DOM shell, which is the same split as `FOSCommandBarView` and
 * `FOSFieldView`: the shell owns pixels, this owns behaviour, and behaviour is
 * therefore testable under `node --test` with no build, no window and no
 * microphone. Each method returns the effect its caller should apply, so the
 * shell never makes a decision of its own.
 *
 * Three rules are worth reading before the code, because each is a judgement
 * rather than a mechanism:
 *
 *   *Cancel always works, and never executes.* A misheard command is the
 *   failure mode people fear about voice, so Escape has to be reachable from
 *   every state including the one where the transcript has already arrived.
 *
 *   *Typing wins.* If the user touches the keyboard mid-utterance the voice
 *   turn is abandoned without executing and without touching the input. Two
 *   modalities writing one field is the one place "the same surface" could turn
 *   from a promise into a collision, and the resolution has to be the one the
 *   user is actively doing.
 *
 *   *Voice writes the whole line.* The bar's existing text is snapshotted on
 *   press and restored on anything but a successful utterance. Appending to a
 *   half-typed line is the more interesting mixed-modality behaviour, and is
 *   deliberately not guessed at before it has been used in a browser — see
 *   `GRAMMAR.md` §8.
 */

import { SPEECH, normaliseTranscript } from "./FOSVoiceTranscript.sys.mjs";

/** States. */
export const IDLE = "idle";
/** The key is down; the microphone and the model are being made ready. */
export const ARMING = "arming";
/** The key is down and audio is being captured. */
export const LISTENING = "listening";
/** The key is up and the model is working on what it heard. */
export const TRANSCRIBING = "transcribing";

/**
 * Notices. Codes rather than sentences, because the shell owns wording — the
 * same reason `FOSCommandParser` reports error codes.
 */
export const NOTICE_TOO_SHORT = "too-short";
export const NOTICE_NOTHING_HEARD = "nothing-heard";
export const NOTICE_UNAVAILABLE = "unavailable";

const ACTIVE = new Set([ARMING, LISTENING, TRANSCRIBING]);

/**
 * One window's push-to-talk turn.
 *
 * The caller drives it with what happened — the key went down, the microphone
 * opened, a partial arrived — and applies the effect it gets back. An effect is
 * always the same shape:
 *
 *   `state`   the state after this event, for the shell's own indicator
 *   `input`   text to put in the bar, or null to leave it exactly as it is
 *   `notice`  a code to show, or null
 *   `run`     a line to hand the parser and execute, or null
 *   `capture` "start" or "stop" for the audio side, or null
 */
export class VoiceSession {
  #state = IDLE;
  #echo = "";
  #notice = null;
  #restore = "";

  /** @returns {string} One of IDLE, ARMING, LISTENING, TRANSCRIBING. */
  get state() {
    return this.#state;
  }

  /** @returns {boolean} Whether a turn is under way in any of its stages. */
  get active() {
    return ACTIVE.has(this.#state);
  }

  /** @returns {string} The transcript so far, as shown in the bar. */
  get echo() {
    return this.#echo;
  }

  /** @returns {?string} The notice code currently standing, if any. */
  get notice() {
    return this.#notice;
  }

  /** @returns {string} What the bar held when the turn began. */
  get restoreText() {
    return this.#restore;
  }

  #effect({ input = null, notice = null, run = null, capture = null } = {}) {
    return { state: this.#state, input, notice, run, capture };
  }

  #reset() {
    this.#state = IDLE;
    this.#echo = "";
  }

  /**
   * The talk key went down.
   *
   * Ignored while a turn is already under way, which is not a nicety: holding a
   * key produces auto-repeat, so a press that restarted the turn would make
   * holding the key down — the entire gesture — impossible.
   *
   * @param {object} [options]
   * @param {string} [options.text] What the bar holds now, to be restored if
   *   the turn does not produce a usable transcript.
   */
  press({ text = "" } = {}) {
    if (this.active) {
      return this.#effect();
    }
    this.#restore = typeof text === "string" ? text : "";
    this.#echo = "";
    this.#notice = null;
    this.#state = ARMING;
    return this.#effect({ capture: "start" });
  }

  /** The microphone is open and the model is loaded. */
  armed() {
    if (this.#state !== ARMING) {
      return this.#effect();
    }
    this.#state = LISTENING;
    return this.#effect();
  }

  /**
   * The audio side could not start, or the model failed.
   *
   * Refusing permission lands here too, and lands the same way: the turn ends,
   * the bar goes back to what the user had, and the keyboard path is untouched.
   */
  failed() {
    if (!this.active) {
      return this.#effect();
    }
    this.#reset();
    this.#notice = NOTICE_UNAVAILABLE;
    return this.#effect({
      input: this.#restore,
      notice: NOTICE_UNAVAILABLE,
      capture: "stop",
    });
  }

  /**
   * The talk key came up.
   *
   * Coming up before the microphone opened is a tap rather than a turn — there
   * is no audio to transcribe — and is refused with the same reason a recording
   * too short to be speech gets, because to the user it is the same mistake.
   */
  release() {
    if (this.#state === ARMING) {
      this.#reset();
      this.#notice = NOTICE_TOO_SHORT;
      return this.#effect({
        input: this.#restore,
        notice: NOTICE_TOO_SHORT,
        capture: "stop",
      });
    }
    if (this.#state !== LISTENING) {
      return this.#effect();
    }
    this.#state = TRANSCRIBING;
    return this.#effect({ capture: "stop" });
  }

  /**
   * A partial transcript arrived. This is the echo, and it is the whole reason
   * the turn is allowed to take a second: the user watches the words appear in
   * the field they would have typed them into.
   *
   * A partial that normalises to nothing leaves the echo alone rather than
   * blanking it, so a bracketed annotation mid-utterance does not make the line
   * flicker.
   *
   * @param {string} raw The model's partial output.
   */
  partial(raw) {
    if (this.#state !== LISTENING && this.#state !== TRANSCRIBING) {
      return this.#effect();
    }
    const result = normaliseTranscript(raw);
    if (result.type !== SPEECH) {
      return this.#effect();
    }
    this.#echo = result.text;
    return this.#effect({ input: result.text });
  }

  /**
   * The final transcript arrived; the turn ends here either way.
   *
   * A transcript that is not speech does not run and does not stay on screen.
   * Whisper answers silence with a confident sentence rather than with nothing
   * (`FOSVoiceTranscript`), so "the model returned a string" is not evidence
   * that the user said anything, and executing on that evidence would both do
   * the wrong thing and record a query the user never asked.
   *
   * @param {string} raw The model's final output.
   */
  final(raw) {
    if (this.#state !== TRANSCRIBING) {
      return this.#effect();
    }
    const result = normaliseTranscript(raw);
    this.#reset();
    if (result.type !== SPEECH) {
      this.#notice = NOTICE_NOTHING_HEARD;
      return this.#effect({
        input: this.#restore,
        notice: NOTICE_NOTHING_HEARD,
      });
    }
    this.#notice = null;
    return this.#effect({ input: result.text, run: result.text });
  }

  /** Escape. Abandons the turn from any state without executing. */
  cancel() {
    if (!this.active) {
      return this.#effect();
    }
    this.#reset();
    this.#notice = null;
    return this.#effect({ input: this.#restore, capture: "stop" });
  }

  /**
   * The user typed while a turn was under way. The turn is abandoned and the
   * input is left exactly as the keystroke left it — restoring the snapshot
   * here would delete what they are in the middle of writing.
   */
  typed() {
    if (!this.active) {
      return this.#effect();
    }
    this.#reset();
    this.#notice = null;
    return this.#effect({ capture: "stop" });
  }
}
