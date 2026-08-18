/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Marks: the addressing layer shared by keyboard and voice.
 *
 * Every addressable object — a Field card, a trail node, a context — carries a
 * mark: one letter, displayed, spoken as a word. `design/GRAMMAR.md` §2 is the
 * specification; the two rules that matter are that a mark is sticky for the
 * object's lifetime, and that the letter and the word are the same mark in two
 * modalities rather than two parallel naming schemes.
 *
 * This module is deliberately free of Gecko APIs so it can be unit tested
 * without a build.
 */

/**
 * Talon's monosyllabic alphabet. It exists because its author optimised it for
 * recognition accuracy under exactly this load, and it maps one word to each
 * letter, which is what lets a single token be either typed or spoken.
 */
export const MARK_WORDS = Object.freeze({
  a: "air",
  b: "bat",
  c: "cap",
  d: "drum",
  e: "each",
  f: "fine",
  g: "gust",
  h: "harp",
  i: "sit",
  j: "jury",
  k: "crunch",
  l: "look",
  m: "made",
  n: "near",
  o: "odd",
  p: "pit",
  q: "quench",
  r: "red",
  s: "sun",
  t: "trap",
  u: "urge",
  v: "vest",
  w: "whale",
  x: "plex",
  y: "yank",
  z: "zip",
});

export const MARK_LETTERS = Object.freeze(Object.keys(MARK_WORDS));

const WORD_TO_LETTER = Object.freeze(
  Object.fromEntries(
    Object.entries(MARK_WORDS).map(([letter, word]) => [word, letter])
  )
);

/**
 * Resolve a token to a mark letter, accepting either modality's form: the
 * letter `c` as typed, or the word `cap` as spoken. Returns null if the token
 * is neither, which is how the parser tells a mark from free text.
 */
export function resolveMarkToken(token) {
  if (typeof token !== "string") {
    return null;
  }
  const t = token.toLowerCase();
  if (t.length === 1 && Object.hasOwn(MARK_WORDS, t)) {
    return t;
  }
  return Object.hasOwn(WORD_TO_LETTER, t) ? WORD_TO_LETTER[t] : null;
}

/** The spoken form of a mark letter. */
export function markWord(letter) {
  return MARK_WORDS[letter] ?? null;
}

/**
 * Letters to try when marking an object, most mnemonic first.
 *
 * Cursorless puts a hat on a character of the token itself, so the name is
 * derived from the thing rather than assigned arbitrarily. Doing the same here
 * costs nothing and makes a mark guessable before it has been learned: a card
 * titled "gecko" prefers `g`. Distinct letters of the label come first, in the
 * order they appear, then the rest of the alphabet as a fallback.
 */
function preferenceOrder(label) {
  const seen = new Set();
  const order = [];
  for (const ch of String(label ?? "").toLowerCase()) {
    if (Object.hasOwn(MARK_WORDS, ch) && !seen.has(ch)) {
      seen.add(ch);
      order.push(ch);
    }
  }
  for (const letter of MARK_LETTERS) {
    if (!seen.has(letter)) {
      order.push(letter);
    }
  }
  return order;
}

/**
 * The live set of marked objects.
 *
 * Objects are identified by an opaque id supplied by the caller. `type` is one
 * of the addressable kinds ("card", "node", "context", "trail", "link") and is
 * what lets the command bar narrow candidates to those the pending action can
 * actually apply to.
 */
export class MarkRegistry {
  #byId = new Map();
  #byLetter = new Map();

  /**
   * Give an object a mark, or return the one it already has.
   *
   * Assignment is idempotent by design: this is the stickiness rule, and the
   * reason a mark can be learned. Re-registering an object that moved, was
   * re-rendered or was re-clustered must never change its letter.
   *
   * Returns the letter, or null if all 26 are held — in which case the object
   * is still registered and is reachable by search, per GRAMMAR.md §2.
   */
  assign(id, { label = "", type = "card" } = {}) {
    const existing = this.#byId.get(id);
    if (existing) {
      // Metadata may legitimately change (a card's title, say). The mark
      // may not.
      existing.label = label;
      existing.type = type;
      return existing.letter;
    }

    let letter = null;
    for (const candidate of preferenceOrder(label)) {
      if (!this.#byLetter.has(candidate)) {
        letter = candidate;
        break;
      }
    }

    const entry = { id, letter, label, type };
    this.#byId.set(id, entry);
    if (letter) {
      this.#byLetter.set(letter, entry);
    }
    return letter;
  }

  /** Drop an object and free its letter for reuse. */
  release(id) {
    const entry = this.#byId.get(id);
    if (!entry) {
      return false;
    }
    this.#byId.delete(id);
    if (entry.letter) {
      this.#byLetter.delete(entry.letter);
    }
    return true;
  }

  /** The letter held by an object, or null. */
  markOf(id) {
    return this.#byId.get(id)?.letter ?? null;
  }

  /** The object holding a letter, or null. */
  objectAt(letter) {
    return this.#byLetter.get(letter)?.id ?? null;
  }

  /** Whether a letter is currently held by a live object. */
  isLive(letter) {
    return this.#byLetter.has(letter);
  }

  /** The type of the object holding a letter, or null. */
  typeAt(letter) {
    return this.#byLetter.get(letter)?.type ?? null;
  }

  /**
   * Marked objects, optionally filtered to a set of types. This is what feeds
   * the command bar's live-narrowing list once an action is known — the same
   * filter serves the keyboard user's candidate list and the voice grammar.
   */
  candidates(types = null) {
    const wanted = types ? new Set(types) : null;
    const out = [];
    for (const entry of this.#byLetter.values()) {
      if (!wanted || wanted.has(entry.type)) {
        out.push({
          id: entry.id,
          letter: entry.letter,
          word: MARK_WORDS[entry.letter],
          label: entry.label,
          type: entry.type,
        });
      }
    }
    out.sort((a, b) => a.letter.localeCompare(b.letter));
    return out;
  }

  get size() {
    return this.#byId.size;
  }

  clear() {
    this.#byId.clear();
    this.#byLetter.clear();
  }
}
