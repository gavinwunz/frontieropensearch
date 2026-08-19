/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A voice turn, as a state machine with no microphone in it.
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
 *
 *   *There are three gestures and one turn.* Push-to-talk is the default; shift
 *   latches; and a bare tap — a press that comes back up inside `TAP_MS` —
 *   latches too. All three arm, listen, transcribe and run down exactly one
 *   path, and the whole of the difference between them is which event ends the
 *   turn. That is the test of whether it really is one path, and the reason to
 *   keep applying it: a gesture that needed its own state would be a second
 *   mode wearing a gesture's clothes.
 *
 *   *A microphone nobody is holding is bounded by what it hears.* The turn's
 *   deadlines are about time; these two are about the room, and they exist only
 *   for the latched turn, because it is the only one with nobody's finger on a
 *   key. They are what makes the bare tap offerable — see
 *   `INITIAL_SILENCE_DEADLINE_MS`.
 *
 *   *No stage may last forever, because nothing else will end it.* This is the
 *   one rule that comes from Gecko rather than from the interface. A chrome
 *   window's `getUserMedia` is `CallerType::System`, so `MediaManager` sets
 *   `privileged` and `askPermission` is false: it never prompts. The sharing
 *   indicator does not cover it either — `recording-device-events` is observed
 *   by `BrowserProcessChild`, a process actor registered without
 *   `includeParent`, so nothing in the parent process is listening when the
 *   parent process is the one recording. A microphone opened here is opened
 *   with no prompt, no indicator and no entry in the permissions UI, and the
 *   only thing standing between that and a microphone left open is this state
 *   machine. Every active stage therefore carries a deadline, and the shell is
 *   given it rather than choosing it. See `GRAMMAR.md` §8.
 */

import {
  SPEECH,
  TOO_QUIET,
  normaliseTranscript,
} from "./FOSVoiceTranscript.sys.mjs";

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
export const NOTICE_TOO_QUIET = "too-quiet";
export const NOTICE_NOTHING_HEARD = "nothing-heard";
export const NOTICE_UNAVAILABLE = "unavailable";

const ACTIVE = new Set([ARMING, LISTENING, TRANSCRIBING]);

/**
 * How long each active stage may last before the turn is ended for it. Each is
 * chosen where it costs nothing rather than picked as a round number.
 *
 * `ARMING` is the microphone opening and the model becoming ready. Ten seconds
 * is far longer than either takes once the model is resident, and a turn that
 * cannot start inside it has failed *as a turn* whatever the reason — so a
 * model that is not yet downloaded is refused here and warmed in the
 * background, rather than left to be paid for by a user holding a key down.
 *
 * `LISTENING` is the only one that is a safety bound rather than a courtesy,
 * and it is the model's own window: Whisper transcribes a fixed 30-second mel
 * window, so audio past 30 seconds is discarded by the model regardless. The
 * cap is therefore free — it can only end turns whose tail was going to be
 * thrown away — which is what makes it safe to set it low enough to matter.
 *
 * `TRANSCRIBING` is the model working, against a budget of ~1s natural and 2s
 * tolerable (`IDEAS.md`, run 23). Fifteen seconds does not enforce that budget;
 * it catches an engine that has hung, which is a different failure and the only
 * one a deadline can do anything about.
 */
export const ARMING_DEADLINE_MS = 10000;
export const LISTENING_DEADLINE_MS = 30000;
export const TRANSCRIBING_DEADLINE_MS = 15000;

const DEADLINES = {
  [ARMING]: ARMING_DEADLINE_MS,
  [LISTENING]: LISTENING_DEADLINE_MS,
  [TRANSCRIBING]: TRANSCRIBING_DEADLINE_MS,
};

/**
 * The two bounds that come from what the microphone hears rather than from the
 * clock, and they apply to a latched turn only.
 *
 * `LISTENING_DEADLINE_MS` above is a bound on a *turn*. Neither of these is:
 * they are bounds on an **unattended microphone**, and the distinction is the
 * whole of why they exist. A held turn has a finger on the key, so the user is
 * present continuously and the only thing that should end their listen is
 * letting go. A latched turn has nobody's finger on anything, no prompt and no
 * platform indicator (see the head of this file), and thirty seconds is a long
 * time for a device in that state to stay open because somebody brushed a key.
 *
 * Speech recognisers have named both of these for decades — Windows'
 * `SpeechRecognizerTimeouts` calls them `InitialSilenceTimeout` and
 * `EndSilenceTimeout` — and this is that pair, with their documented example
 * values as the starting point. `IDEAS.md` (run 40) has the sources.
 *
 * `INITIAL_SILENCE` is "the microphone opened and nobody ever said anything".
 * Six seconds is long enough to cover a user who latched deliberately and then
 * gathered their thoughts, and short enough that a mis-tap costs six seconds
 * rather than thirty. It is the bound that makes a bare tap safe enough to
 * offer at all — see `release`, where the tap is read.
 *
 * `END_SILENCE` is "somebody spoke and has now stopped", which is endpointing
 * rather than safety, and it is the reason a latched turn is worth using: the
 * turn ends itself when the utterance does, so the second press becomes a way
 * to stop early rather than the only way to stop. One and a half seconds sits
 * just above Windows' 1.2s example, because a command bar line is composed
 * more deliberately than dictation and a pause mid-line must not end the turn.
 *
 * Both are re-armed against the elapsed listen rather than added to it, so
 * neither can push a turn past `LISTENING_DEADLINE_MS` — Whisper's own 30s mel
 * window, past which audio is discarded by the model regardless. A bound that
 * extended it would silently throw the user's last words away.
 */
export const INITIAL_SILENCE_DEADLINE_MS = 6000;
export const END_SILENCE_DEADLINE_MS = 1500;

/**
 * How long a press may last and still be a tap rather than a hold.
 *
 * The bare tap is the gesture a user with one reliable finger would actually
 * choose: no modifier, no chord, no second key. It could not be offered while
 * the only bound on the turn it started was thirty seconds; with the two above
 * it can, because the cost of a mis-tap is now a microphone that closes itself
 * after six seconds of hearing nothing.
 *
 * 400ms is under the 500ms both major platforms use for a long press, and over
 * an ordinary tap of ~100ms. The band between is genuinely ambiguous — a
 * one-word utterance said at speed runs 250–400ms (`MIN_UTTERANCE_MS`) — but
 * guessing wrong there stopped being expensive once `END_SILENCE` existed: a
 * hold mistaken for a tap latches, the user keeps talking, and the turn ends
 * a second and a half after they stop instead of the moment they let go.
 */
export const TAP_MS = 400;

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
 *   `deadline` milliseconds this stage may last, or null
 *
 * `deadline` is a value rather than an instruction, and null does not mean
 * "no deadline": it means "the one you are already running is still right".
 * The shell arms a timer whenever it gets a number, leaves its timer alone on
 * null, and clears it whenever `state` is `idle` — which every terminating
 * path reaches, so there is no way to finish a turn and keep a timer. An event
 * the session ignores reports null for exactly this reason: an auto-repeat
 * press arriving mid-utterance must not restart the clock on an open
 * microphone.
 */
export class VoiceSession {
  #state = IDLE;
  #echo = "";
  #notice = null;
  #restore = "";
  #latched = false;
  #now;
  /** When LISTENING began, so the silence bounds cannot outrun Whisper's 30s. */
  #listeningSince = 0;
  /** Whether the level has crossed the speech floor at any point this turn. */
  #heardSpeech = false;
  /** Whether it has since fallen back below it. */
  #inSilence = false;
  /** Whether anything is reporting the level at all. */
  #monitored = false;

  /**
   * @param {object} [options]
   * @param {Function} [options.now] Milliseconds from any monotonic-enough
   *   source, used for one thing only: keeping the silence bounds inside the
   *   model's listening window. Injected rather than read directly so that the
   *   one part of this module which is about duration rather than order stays
   *   testable under `node --test` without waiting in real time for it.
   */
  constructor({ now = () => Date.now() } = {}) {
    this.#now = now;
  }

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

  /**
   * Whether this turn is latched, and so is not holding a key down.
   *
   * The shell reads it to say how to stop — a latched microphone is open with
   * nobody's finger on it, so the indicator that is the only signal it is open
   * has to carry the gesture that closes it.
   *
   * @returns {boolean}
   */
  get latched() {
    return this.#latched;
  }

  #effect({
    input = null,
    notice = null,
    run = null,
    capture = null,
    deadline = null,
  } = {}) {
    return { state: this.#state, input, notice, run, capture, deadline };
  }

  /**
   * The effect of entering `state`, which is the one place a deadline is
   * attached. Going through here rather than passing `deadline` at each call
   * site is what stops a stage being added later without one.
   *
   * @param {string} state
   * @param {object} [rest] The rest of the effect.
   */
  #enter(state, rest = {}) {
    this.#state = state;
    if (state === LISTENING) {
      this.#listeningSince = this.#now();
      return this.#effect({ ...rest, deadline: this.#listenDeadline() });
    }
    return this.#effect({ ...rest, deadline: DEADLINES[state] ?? null });
  }

  /**
   * How long the listen may last from *now*, which is one question with three
   * answers and one subtraction.
   *
   * A held turn is bounded only by the model's window: the user's finger is the
   * decision, and a bound keyed on what the room sounds like would cut off
   * somebody who paused to think with the key still down.
   *
   * A latched turn is bounded by whichever of the three is nearest. The
   * subtraction is the part worth reading — every silence bound is expressed as
   * time *remaining* in the model's window rather than as time added to now, so
   * re-arming on each word cannot walk a turn past the 30 seconds Whisper will
   * actually transcribe. §9's lesson was that a bound defined in terms of an
   * ordinary event disappears when the event does; this is the same lesson
   * about a bound defined in terms of the moment it happens to be armed.
   *
   * @returns {number}
   */
  #listenDeadline() {
    if (!this.#latched || !this.#monitored) {
      return LISTENING_DEADLINE_MS;
    }
    const remaining = Math.max(
      0,
      LISTENING_DEADLINE_MS - (this.#now() - this.#listeningSince)
    );
    if (!this.#heardSpeech) {
      return Math.min(INITIAL_SILENCE_DEADLINE_MS, remaining);
    }
    if (this.#inSilence) {
      return Math.min(END_SILENCE_DEADLINE_MS, remaining);
    }
    return remaining;
  }

  #reset() {
    this.#state = IDLE;
    this.#echo = "";
    this.#latched = false;
    this.#heardSpeech = false;
    this.#inSilence = false;
    this.#monitored = false;
  }

  /**
   * The talk key went down.
   *
   * `latch` is the second gesture, and it is a gesture rather than a second
   * mode: a latched turn arms, listens, transcribes and runs down exactly this
   * path, and the only thing that differs is which event ends it. Holding the
   * key stays the default, because a held key makes the microphone's state
   * something the user is continuously doing. But sustained pressure is
   * precisely what tremor, arthritis, carpal tunnel and fatigue make expensive,
   * and dictation tools written for those users converge on tap-to-start,
   * tap-to-stop — so a voice path whose only gesture is a held key has quietly
   * excluded part of the audience `GRAMMAR.md` §5's "no separate accessibility
   * mode" was written for. `IDEAS.md` (run 30) carries the sources.
   *
   * A press during a turn is otherwise ignored, which is not a nicety: holding
   * a key produces auto-repeat, so a press that restarted the turn would make
   * holding the key down — the entire gesture — impossible. The exception is
   * the latched turn, where the next press is the half of the gesture that ends
   * it, and where *any* press ends it rather than only a latching one. That
   * forgiveness is deliberate and asymmetric on purpose: a user who latched and
   * then reached for the key without the modifier has asked to stop, ending a
   * turn early costs one utterance, and failing to end one leaves a microphone
   * open that nothing in the platform will draw an indicator for.
   *
   * Stopping a latched turn before the microphone ever opened is a cancel
   * rather than a refusal. Nothing was recorded and the user chose to stop, so
   * there is nothing to tell them — and "hold the key down while you speak" is
   * advice about a gesture they deliberately did not use.
   *
   * @param {object} [options]
   * @param {string} [options.text] What the bar holds now, to be restored if
   *   the turn does not produce a usable transcript.
   * @param {boolean} [options.latch] Start a latched turn, which the next
   *   press ends rather than a key coming up.
   */
  press({ text = "", latch = false } = {}) {
    if (this.active) {
      if (this.#latched) {
        return this.#state === ARMING ? this.cancel() : this.#finish();
      }
      return this.#effect();
    }
    this.#restore = typeof text === "string" ? text : "";
    this.#echo = "";
    this.#notice = null;
    this.#latched = !!latch;
    this.#heardSpeech = false;
    this.#inSilence = false;
    return this.#enter(ARMING, { capture: "start" });
  }

  /**
   * The microphone is open and the model is loaded.
   *
   * `monitored` is the caller saying whether anything is able to report what
   * the room sounds like. It is not a detail: a level monitor that is not
   * running reads a flat zero, which is indistinguishable from silence, so a
   * turn that assumed one was there would end six seconds into somebody's
   * sentence and tell them nothing was heard. Without it the silence bounds are
   * not armed at all and the turn is bounded by the model's window and the key,
   * exactly as it was before those bounds existed — the failure degrades to the
   * previous design rather than to a worse one.
   *
   * @param {object} [options]
   * @param {boolean} [options.monitored] Whether `heard` and `quiet` will come.
   */
  armed({ monitored = false } = {}) {
    if (this.#state !== ARMING) {
      return this.#effect();
    }
    this.#monitored = !!monitored;
    return this.#enter(LISTENING);
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
   * A latched turn ignores it, and has to: the key that started the turn is
   * released immediately, since not holding it is the entire point. What ends a
   * latched turn is the next press, or one of the endings every turn already
   * has — Escape, a lost focus, or the `LISTENING` deadline.
   *
   * A key that comes up inside `TAP_MS` did not end a turn, it started one:
   * this is the bare tap, and it is the same gesture that used to be refused as
   * "too short to hear". Nothing about the turn changes except which event will
   * end it — the same claim `press`'s latch makes, and true for the same reason
   * — so this latches in place rather than starting anything over. The listen
   * is re-armed because a turn that has just become unattended is bounded by
   * silence and one that was held is not.
   *
   * Reading the tap here rather than at the press is not a shortcut. Whether a
   * press is a tap is not knowable while it is happening; the alternative is to
   * ask the user to declare it with a modifier, which is the thing the bare tap
   * exists to remove.
   *
   * `heldMs` is measured by the shell and judged here, which is the same split
   * as `heard`: the caller reports a fact it is the only one able to observe —
   * the gap between the real keydown and keyup timestamps, which is not the
   * same as the gap between the two handlers running — and this decides what
   * the fact means. It defaults to a hold, so a caller that does not measure
   * gets the behaviour that existed before the tap did.
   *
   * @param {object} [options]
   * @param {number} [options.heldMs] How long the key was actually down.
   */
  release({ heldMs = Infinity } = {}) {
    if (this.#latched) {
      return this.#effect();
    }
    if (this.active && heldMs < TAP_MS) {
      this.#latched = true;
      return this.#state === LISTENING
        ? this.#effect({ deadline: this.#listenDeadline() })
        : this.#effect();
    }
    return this.#finish();
  }

  /**
   * The level crossed the speech floor.
   *
   * Reported by the shell, because it is the only part that can hear anything,
   * and against `FOSVoiceTranscript`'s own `MIN_RMS` rather than a second
   * threshold of this module's choosing. Sharing the floor is what guarantees
   * the bound cannot end a turn the audio gate would have accepted: the gate
   * averages over the whole recording, pauses included, so any window loud
   * enough to be speech on its own is louder than the average it will be judged
   * by.
   *
   * A held turn ignores this, and so does a turn already known to be speaking —
   * the second is not an optimisation but the rule about restarting clocks: a
   * word arriving every hundred milliseconds must not re-arm anything, or the
   * bound would only ever measure the gap since the last poll.
   */
  heard() {
    if (this.#state !== LISTENING || !this.#latched || !this.#monitored) {
      return this.#effect();
    }
    if (this.#heardSpeech && !this.#inSilence) {
      return this.#effect();
    }
    this.#heardSpeech = true;
    this.#inSilence = false;
    return this.#effect({ deadline: this.#listenDeadline() });
  }

  /**
   * The level fell back below the floor.
   *
   * This arms the end-silence bound and nothing else, which is why the gaps
   * between ordinary words cost nothing: the pause has to outlast
   * `END_SILENCE_DEADLINE_MS` before it means anything, and the next word
   * cancels it by re-arming through `heard`. The deadline is the hysteresis, so
   * the level check itself needs none.
   *
   * Silence before anybody has spoken is not endpointing — it is the state the
   * turn started in, and `INITIAL_SILENCE` already bounds it — so it is ignored
   * rather than treated as the end of an utterance that never began.
   */
  quiet() {
    if (this.#state !== LISTENING || !this.#latched || !this.#monitored) {
      return this.#effect();
    }
    if (!this.#heardSpeech || this.#inSilence) {
      return this.#effect();
    }
    this.#inSilence = true;
    return this.#effect({ deadline: this.#listenDeadline() });
  }

  /**
   * Stop recording, whatever asked for it.
   *
   * The key coming up, the second press of a latched turn and the listening
   * deadline running out all mean one thing — no more audio — so they share
   * this, and a way to end a turn added later cannot accidentally become a way
   * to end it *differently*. The deadline in particular goes through here and
   * not through `release`, because a latched turn ignores `release` and would
   * otherwise be the one turn in the design that nothing bounded.
   *
   * Stopping before the microphone opened is a tap rather than a turn — there
   * is no audio to transcribe — and is refused with the same reason a recording
   * too short to be speech gets, because to the user it is the same mistake.
   */
  #finish() {
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
    return this.#enter(TRANSCRIBING, { capture: "stop" });
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

  /**
   * The audio gate refused the recording before the model ever saw it.
   *
   * `FOSVoiceTranscript.audioIsSpeech` is the gate, and it runs in the shell
   * because it needs the samples. Its verdict is nonetheless a turn-ending
   * event like any other, so it comes back here rather than being reported by
   * the shell directly: the notice, and the decision to put the bar back the
   * way the user left it, are this object's to make.
   *
   * The two refusals get different words on purpose. Too short is the same
   * mistake as a key that came up before the microphone opened and is told the
   * same way. Too quiet is not a mistake at all — it is a real utterance the
   * gate could not tell from a room — and a user who is told "nothing heard"
   * when they did speak learns the wrong lesson about the microphone.
   *
   * @param {string} reason A verdict from `audioIsSpeech`.
   */
  refused(reason) {
    if (this.#state !== TRANSCRIBING) {
      return this.#effect();
    }
    this.#reset();
    this.#notice = reason === TOO_QUIET ? NOTICE_TOO_QUIET : NOTICE_TOO_SHORT;
    return this.#effect({ input: this.#restore, notice: this.#notice });
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

  /**
   * The window lost focus mid-turn.
   *
   * This is not a tidiness measure. Holding a key and then switching away is
   * the ordinary way a key-up goes missing — the release is delivered to
   * whatever took the focus, not to us — and it is the exact gesture that
   * leaves a push-to-talk microphone open in every application that has ever
   * shipped one. Here the consequence is worse than a hot mic in a voice chat,
   * because there is no prompt and no indicator to notice it by (see the head
   * of this file), so focus loss has to end the turn rather than merely be
   * survivable.
   *
   * It is a cancel and not a release: the user's attention has left the window,
   * and running a command into a window somebody has just looked away from is
   * the misheard-command failure with the one safeguard — watching the echo —
   * removed.
   */
  blurred() {
    return this.cancel();
  }

  /**
   * The deadline for the current stage ran out.
   *
   * Both outcomes are stages that already exist, which is the point: a deadline
   * decides *when* a turn ends and never invents a way for it to end.
   *
   * A listen that runs out is a key that came up. The audio is real either way
   * — if the user is still speaking it is a long utterance, and if the key-up
   * was lost it is a room the user has stopped talking in — so it is
   * transcribed rather than discarded, and the two cases need no telling apart:
   * a long utterance transcribes, and a room does not clear the audio gate. It
   * ends the recording directly rather than through `release`, because a
   * latched turn ignores `release` and would otherwise be unbounded.
   *
   * A latched turn reaches here by three different clocks — the model's window,
   * `INITIAL_SILENCE` and `END_SILENCE` — and only the first of those needs
   * telling apart from the others. See the branch below.
   *
   * An arm or a transcribe that runs out is the failure that stage reports
   * anyway. The device never opened, or the engine never answered; either way
   * the turn is unavailable, the bar goes back to what the user had, and the
   * keyboard path is untouched.
   */
  expired() {
    if (this.#state === LISTENING) {
      // Which of the three listen bounds just ran out is one question: was
      // anything ever said? If nothing was, this is a microphone that opened
      // for a key nobody meant to press, there is no audio worth the decode,
      // and the turn ends the way every other turn that produced no speech
      // ends. Inventing a notice for it would make a mis-tap a thing the user
      // has to learn about; `NOTICE_NOTHING_HEARD` is already exactly true.
      //
      // If something was said, every remaining case — the utterance ended, the
      // model's window ran out, a held key was lost — means the same thing as a
      // key coming up, and goes the same way.
      if (this.#latched && this.#monitored && !this.#heardSpeech) {
        this.#reset();
        this.#notice = NOTICE_NOTHING_HEARD;
        return this.#effect({
          input: this.#restore,
          notice: NOTICE_NOTHING_HEARD,
          capture: "stop",
        });
      }
      return this.#finish();
    }
    if (this.#state === ARMING || this.#state === TRANSCRIBING) {
      return this.failed();
    }
    return this.#effect();
  }
}
