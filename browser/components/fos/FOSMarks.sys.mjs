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
 *
 * @param {string} token A token from the input stream.
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

/**
 * The spoken form of a mark letter.
 *
 * @param {string} letter A mark letter, a-z.
 */
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
 *
 * @param {string} label The object's own label.
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
   *
   * @param {string|number} id Caller-supplied object id.
   * @param {object} [options]
   * @param {string} [options.label] Used to pick a mnemonic letter.
   * @param {string} [options.type] One of the addressable kinds.
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

  /**
   * Drop an object and free its letter for reuse.
   *
   * @param {string|number} id Caller-supplied object id.
   */
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

  /**
   * The letter held by an object, or null.
   *
   * @param {string|number} id Caller-supplied object id.
   */
  markOf(id) {
    return this.#byId.get(id)?.letter ?? null;
  }

  /**
   * The object holding a letter, or null.
   *
   * @param {string} letter A mark letter, a-z.
   */
  objectAt(letter) {
    return this.#byLetter.get(letter)?.id ?? null;
  }

  /**
   * The whole entry holding a letter, or null.
   *
   * The one method `ScopedMarks` needs that the others can be written in terms
   * of, which is why it exists: a composite asking `isLive` and then `typeAt`
   * would resolve the letter twice and could resolve it in two different scopes
   * between the calls. Answering once, with everything, removes the question.
   *
   * The `accepts` argument is taken and ignored here. A single registry has no
   * scope to choose between, so it always answers with what it holds and lets
   * the caller judge the type — which is what keeps a bare `MarkRegistry` and a
   * `ScopedMarks` interchangeable at the parser's one call site.
   *
   * @param {string} letter A mark letter, a-z.
   * @param {?string[]} [_accepts] Unused. See above.
   */
  // eslint-disable-next-line no-unused-vars
  entryAt(letter, _accepts = null) {
    const entry = this.#byLetter.get(letter);
    return entry ? { ...entry } : null;
  }

  /**
   * Whether a letter is currently held by a live object.
   *
   * @param {string} letter A mark letter, a-z.
   */
  isLive(letter) {
    return this.#byLetter.has(letter);
  }

  /**
   * The type of the object holding a letter, or null.
   *
   * @param {string} letter A mark letter, a-z.
   */
  typeAt(letter) {
    return this.#byLetter.get(letter)?.type ?? null;
  }

  /**
   * Marked objects, optionally filtered to a set of types. This is what feeds
   * the command bar's live-narrowing list once an action is known — the same
   * filter serves the keyboard user's candidate list and the voice grammar.
   *
   * @param {?string[]} types Object types to keep, or null for all.
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

/**
 * Several registries read as one, resolved by what the pending verb accepts.
 *
 * There are twenty-six letters and there is no getting more of them. Trail
 * nodes hold nearly all of them in any session past its first few minutes,
 * which is fine — until the page itself becomes addressable. A page has tens or
 * hundreds of links, they turn over completely on every navigation, and if they
 * competed for the same alphabet they would either get nothing or evict every
 * node mark the user had learned. Either outcome loses the property `GRAMMAR.md`
 * §2 exists to protect.
 *
 * So the page gets its own alphabet, and `c` means one thing among the window's
 * objects and another among the current page's links. That is not the ambiguity
 * it looks like, because a mark is only ever *consumed* in a slot whose accepted
 * types the grammar already knows: `enter` accepts a node and `follow` accepts a
 * link, so neither the parser nor the speaker is ever choosing between them.
 * This class is where that resolution happens — the scopes are ordered, and the
 * first one holding the letter with an accepted type answers.
 *
 * Stickiness survives intact rather than being excepted. §2 says a mark is held
 * until its object goes away; a link's object goes away when the page view does,
 * so a page-scoped alphabet is that rule applied to a shorter-lived object, not
 * a carve-out from it.
 *
 * Read-only on purpose: `assign` and `release` stay on the registry that owns
 * the objects, so there is never a question of which scope a new object lands
 * in.
 */
export class ScopedMarks {
  #scopes = [];

  /**
   * @param {object[]} [scopes] Registries, most specific first.
   */
  constructor(scopes = []) {
    this.#scopes = [...scopes];
  }

  /**
   * Add a scope, if it is not already present.
   *
   * Appended rather than prepended: the window's own objects are registered
   * first and keep priority, so a page cannot shadow a mark the user learned on
   * a card. It never needs to — the two are only ever consulted for different
   * accepted types — but the tie has to break somewhere, and it should break
   * towards the longer-lived object.
   *
   * @param {object} registry A `MarkRegistry`.
   */
  add(registry) {
    if (registry && !this.#scopes.includes(registry)) {
      this.#scopes.push(registry);
    }
    return this;
  }

  /**
   * The entry holding a letter, preferring one the pending verb can apply to.
   *
   * Returns a wrong-typed entry rather than null when that is all there is, so
   * that the parser can still tell "no such mark" from "that mark is a node and
   * this verb wants a link". Reporting the second as the first would send a user
   * looking for a mark that is on their screen.
   *
   * @param {string} letter A mark letter, a-z.
   * @param {?string[]} [accepts] The types the pending verb accepts.
   */
  entryAt(letter, accepts = null) {
    let fallback = null;
    for (const scope of this.#scopes) {
      const entry = scope.entryAt(letter);
      if (!entry) {
        continue;
      }
      if (!accepts?.length || accepts.includes(entry.type)) {
        return entry;
      }
      fallback ??= entry;
    }
    return fallback;
  }

  /**
   * @param {string} letter A mark letter, a-z.
   * @param {?string[]} [accepts] The types the pending verb accepts.
   */
  isLive(letter, accepts = null) {
    return !!this.entryAt(letter, accepts);
  }

  /**
   * @param {string} letter A mark letter, a-z.
   * @param {?string[]} [accepts] The types the pending verb accepts.
   */
  typeAt(letter, accepts = null) {
    return this.entryAt(letter, accepts)?.type ?? null;
  }

  /**
   * @param {string} letter A mark letter, a-z.
   * @param {?string[]} [accepts] The types the pending verb accepts.
   */
  objectAt(letter, accepts = null) {
    return this.entryAt(letter, accepts)?.id ?? null;
  }

  /**
   * Candidates across every scope, filtered to the wanted types.
   *
   * A letter appearing in two scopes contributes one row, from the earlier
   * scope. With a type filter that cannot happen — the scopes hold disjoint
   * types — so this only matters for an unfiltered list, where showing `c`
   * twice with two labels would be a list the user cannot act on.
   *
   * @param {?string[]} types Object types to keep, or null for all.
   */
  candidates(types = null) {
    const out = [];
    const taken = new Set();
    for (const scope of this.#scopes) {
      for (const row of scope.candidates(types)) {
        if (!taken.has(row.letter)) {
          taken.add(row.letter);
          out.push(row);
        }
      }
    }
    out.sort((a, b) => a.letter.localeCompare(b.letter));
    return out;
  }
}
