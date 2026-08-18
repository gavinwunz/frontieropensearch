/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The voice front end's input adapter, and nothing else.
 *
 * `design/GRAMMAR.md` §5 requires that speech and keystrokes meet as one token
 * stream, and that everything downstream — the parser, marks, the action table,
 * execution — never learns which modality produced its input. That requirement
 * is what this module exists to satisfy: it turns what an ASR model emits into
 * the string the keyboard would have produced, and then stops. It knows nothing
 * about actions, marks or the parse, and must not acquire any such knowledge.
 *
 * Two jobs:
 *
 *   1. Decide whether a recording is speech at all       `audioIsSpeech`
 *   2. Turn a transcript into a token-stream line        `normaliseTranscript`
 *
 * The first exists because of a documented Whisper failure mode: on silence,
 * room tone or non-speech audio it does not return nothing, it returns a
 * confident sentence — most famously "thank you" or "thanks for watching",
 * which are training-data artifacts of captioned video. Whisper's own defence
 * (`no_speech_prob` and `avg_logprob`) is reported as insufficient precisely
 * because the hallucinations come out with high confidence. So the mitigation
 * has to sit in front of the model: a recording that is too short or too quiet
 * is never transcribed. `IDEAS.md` (run 24) has the sources.
 *
 * The phrase list below is a backstop for what gets past that gate, not the
 * mechanism. It matters more than it looks: a hallucinated utterance does not
 * merely do the wrong thing, it is recorded by the Context Engine as a query
 * the user asked, and a context poisoned by phantom enquiries is a good deal
 * harder to notice than a search that ran and looked odd.
 *
 * Gecko-free by construction, so it is unit tested under plain `node --test`.
 */

/** `audioIsSpeech` verdicts. */
export const SPEECH = "speech";
export const TOO_SHORT = "too-short";
export const TOO_QUIET = "too-quiet";

/** `normaliseTranscript` rejection reasons. */
export const EMPTY = "empty";
export const MARKER = "marker";
export const HALLUCINATION = "hallucination";

/**
 * The shortest recording worth sending to a model. The shortest thing a user
 * can usefully say is one alphabet word — "cap", "air" — which runs 250–400ms
 * said at speed, so this is set just under that and rejects the press-and-
 * release-by-accident case rather than any real utterance.
 */
export const MIN_UTTERANCE_MS = 250;

/**
 * Amplitude gates, on samples in [-1, 1].
 *
 * Room tone through a laptop microphone sits around 0.001–0.005 RMS and speech
 * at ordinary gain runs 0.02–0.1, so the floor is set an order of magnitude
 * below speech rather than just above silence: the failure this prevents is a
 * phantom command, and the failure it can cause is a quiet utterance refused
 * with the reason shown.
 *
 * The peak gate is not a second loudness test, it is a shape test. Speech has a
 * crest factor of three to five — its peaks tower over its average — so a
 * signal that clears the RMS floor while never peaking is a steady one: a fan,
 * a hum, a hold tone. Requiring both refuses that without refusing quiet
 * speech.
 *
 * What neither gate catches is a short loud noise in an otherwise silent room —
 * a door, a knock on the desk — which clears both comfortably and is exactly
 * the input Whisper answers with a sentence. That is the case the phrase list
 * below exists for, and it is why the list is a real part of the design rather
 * than belt and braces.
 *
 * All three numbers are provisional until the ASR measurement in `STATE.md`
 * runs on real captures from this hardware, which is why they are exported:
 * that measurement sets them, and should not have to edit a literal to do it.
 */
export const MIN_RMS = 0.005;
export const MIN_PEAK = 0.02;

/**
 * Whole utterances that are Whisper's silence artifacts rather than anything a
 * person said. Matched against the fully normalised line and only in whole:
 * "thank you" is refused, "thank you notes for a wedding" is a search like any
 * other. The list is deliberately short and deliberately English-plus-the-two
 * famous ones — a long list starts refusing real speech, and the audio gate
 * above is what is actually supposed to be doing this work.
 */
const HALLUCINATIONS = new Set([
  "you",
  "thank you",
  "thanks",
  "thank you very much",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "subscribe to my channel",
  "bye",
  "bye bye",
  "goodbye",
  // The two most reported non-English artifacts, both captioned-video sign-offs.
  "시청해주셔서 감사합니다",
  "ご視聴ありがとうございました",
]);

/**
 * Non-speech annotations. Whisper brackets what it hears but cannot transcribe
 * — `[BLANK_AUDIO]`, `(silence)`, `[Music]`, `*sniffs*` — and a bracketed run
 * is never something a user dictated at a command bar, so all of them are cut
 * before anything else looks at the line.
 */
const ANNOTATION = /[[(*][^\])*]*[\])*]|[♪♫]+/g;

/** Trailing sentence punctuation, and quotes anywhere at an edge of a token. */
const TRAILING_PUNCT = /[.,!?;:]+$/;
const EDGE_QUOTES = /^["'“”‘’«»¿¡]+|["'“”‘’«»]+$/g;

/**
 * Is this recording worth transcribing?
 *
 * @param {object} recording
 * @param {Float32Array|number[]} recording.samples Mono PCM in [-1, 1].
 * @param {number} recording.sampleRate Hz.
 * @returns {{ok: boolean, reason: string, durationMs: number, rms: number,
 *   peak: number}}
 *   `reason` is SPEECH, TOO_SHORT or TOO_QUIET. The measurements come back
 *   whether or not the verdict is speech, because the caller wants them in the
 *   log when it refuses.
 */
export function audioIsSpeech({ samples, sampleRate } = {}) {
  const length = samples?.length ?? 0;
  const rate = sampleRate > 0 ? sampleRate : 0;
  const durationMs = rate ? (length / rate) * 1000 : 0;

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const value = Math.abs(samples[i]);
    sum += value * value;
    if (value > peak) {
      peak = value;
    }
  }
  const rms = length ? Math.sqrt(sum / length) : 0;

  let reason = SPEECH;
  if (durationMs < MIN_UTTERANCE_MS) {
    reason = TOO_SHORT;
  } else if (rms < MIN_RMS || peak < MIN_PEAK) {
    reason = TOO_QUIET;
  }

  return { ok: reason === SPEECH, reason, durationMs, rms, peak };
}

/**
 * Turn a transcript into the line the keyboard would have produced.
 *
 * Every step here is safe over free text, which is the constraint that shapes
 * the whole function. `name` and `search` take the rest of the utterance
 * verbatim (GRAMMAR.md §6), so this pass may not do anything a person dictating
 * a title or a query would resent: it lowercases, drops sentence punctuation
 * and collapses space, and it does not touch the words themselves. Repairing a
 * misheard word against the grammar's vocabulary would be a different kind of
 * change — it would have to know where free text begins, and so would have to
 * know the grammar — and `IDEAS.md` records why that is deliberately not here.
 *
 * @param {string} raw The model's output, leading space and all.
 * @returns {{type: string, text: string, reason: string}}
 *   `type` is SPEECH or one of EMPTY, MARKER, HALLUCINATION. `text` is the
 *   line to hand the parser, and is "" for anything but SPEECH.
 */
export function normaliseTranscript(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { type: EMPTY, text: "", reason: EMPTY };
  }

  const withoutAnnotations = raw.replace(ANNOTATION, " ");
  if (!withoutAnnotations.trim()) {
    return { type: MARKER, text: "", reason: MARKER };
  }

  const text = withoutAnnotations
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(EDGE_QUOTES, "").replace(TRAILING_PUNCT, ""))
    .filter(Boolean)
    .join(" ");

  if (!text) {
    return { type: EMPTY, text: "", reason: EMPTY };
  }
  if (HALLUCINATIONS.has(text)) {
    return { type: HALLUCINATION, text: "", reason: HALLUCINATION };
  }

  return { type: SPEECH, text, reason: SPEECH };
}
