/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Context Engine's pure derivations.
 *
 * Three questions are answered here, and all three are answered from the raw
 * record alone with no database, no model and no Gecko API — which is what
 * makes them testable under plain `node --test` and what keeps the recording
 * path in `FOSContextEngine` free of judgement calls:
 *
 *   1. What did this query mean?      `normaliseIntent`
 *   2. What does it mention?          `extractEntities`
 *   3. What did this visit amount to? `deriveOutcome`
 *
 * Each of the three is a heuristic, and each is written to be replaceable. The
 * embedding work in `context-engine/SCHEMA.md` supersedes (1) and (2) for
 * clustering; they stay regardless, because a normalised string is legible in a
 * way a 384-dimensional vector is not, and `context_member.source` exists
 * precisely so a membership decision can be explained to the person it was made
 * about.
 */

/**
 * Words carrying no topic. Deliberately short: this list only has to survive
 * being wrong, because dropping a word only weakens a match and never invents
 * one, and an over-long stoplist quietly deletes real queries — "the who",
 * "it", "who" are all things people search for.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * How long a page must hold the foreground before the visit counts as reading.
 *
 * 30 seconds is the threshold industrial search systems use to call a click
 * satisfied, and it is used here for the same reason: it is the only number in
 * this area with a large body of evidence behind it.
 *
 * It is also known to be crude, and the limitation is worth stating rather than
 * inheriting silently. A single fixed threshold assumes every page needs the
 * same time to satisfy, and the dwell-time literature finds the satisfying
 * duration moves with the document — around 30s at a medium reading level and
 * past 50s at a difficult one. So this will call a skimmed reference page
 * bounced and a slowly-read hard page bounced too. It is a floor to improve on
 * with per-page evidence, not a fact.
 */
export const READ_DWELL_MS = 30_000;

/**
 * Clean a raw query into the form used for matching.
 *
 * Order is preserved. Sorting the tokens would make "does a bird fly" and "does
 * a fly bird" the same intent, and the phrase is most of the meaning.
 *
 * @param {string} raw Exactly what was typed or spoken.
 * @returns {string} The normalised intent; "" when nothing survives.
 */
export function normaliseIntent(raw) {
  const words = tokenise(raw);
  const kept = words.filter(word => !STOPWORDS.has(word));
  // A query made entirely of stopwords is a real query — "how do you do" — and
  // returning "" for it would make every such query match every other. Keep the
  // tokens when the filter would empty the string.
  return (kept.length ? kept : words).join(" ");
}

/**
 * Split text into lowercase word tokens.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenise(text) {
  return (
    String(text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      // Keep intra-word apostrophes and hyphens; everything else is a boundary.
      // `\p{L}\p{N}` rather than `\w` so that accented and non-Latin queries are
      // not silently shredded into nothing.
      .split(/[^\p{L}\p{N}'-]+/u)
      .map(word => word.replace(/^[-']+|[-']+$/g, ""))
      .filter(Boolean)
  );
}

/**
 * The deduplication key for an entity.
 *
 * @param {string} name As it appeared.
 * @returns {string} The normalised key stored in `entity.canonical`.
 */
export function canonicalise(name) {
  return tokenise(name).join(" ");
}

/** Salience by evidence, strongest first. See `extractEntities`. */
const WEIGHT_QUOTED = 1.0;
const WEIGHT_PROPER_PHRASE = 0.8;
const WEIGHT_PROPER = 0.6;
const WEIGHT_PLAIN = 0.3;

/**
 * Pull candidate entities out of a piece of text.
 *
 * This is a shallow extractor and says so. Real named-entity recognition is a
 * model's job and belongs with the embedding work, which runs on the in-tree ML
 * runtime; what it would add is exactly the part this cannot do, which is
 * telling a person from an organisation from a place. So `kind` here is
 * `term` for everything except a quoted title, which is `work` — guessing
 * between the other four from capitalisation alone would produce a column full
 * of confident nonsense, and `entity.kind` is meant to be trusted by the
 * context pack.
 *
 * What it can do honestly is rank salience, which is most of the value:
 *
 *   - a quoted phrase is the user stating the unit themselves;
 *   - a run of capitalised words is a name;
 *   - a single capitalised word is weaker, and worthless at the start of a
 *     sentence where capitalisation is grammar rather than evidence;
 *   - everything else is a plain content word.
 *
 * @param {string} text A query, a page title, or a heading.
 * @returns {object[]} `{name, canonical, kind, weight}`, strongest first.
 */
export function extractEntities(text) {
  const source = String(text ?? "").normalize("NFKC");
  const found = new Map();

  /**
   * @param {string} name The surface form.
   * @param {number} weight Salience for this piece of evidence.
   * @param {string} kind An `entity.kind` value.
   */
  const add = (name, weight, kind = "term") => {
    const canonical = canonicalise(name);
    // A bare stopword is never an entity, however it was capitalised.
    if (!canonical || (!canonical.includes(" ") && STOPWORDS.has(canonical))) {
      return;
    }
    const existing = found.get(canonical);
    if (existing) {
      // Repetition is evidence, but with sharply diminishing returns: a word
      // said three times is not three times as salient. Weights stay in [0, 1]
      // so they remain comparable with the ones a model will produce.
      existing.weight = Math.min(1, existing.weight + weight / 2);
      if (kind !== "term") {
        existing.kind = kind;
      }
      return;
    }
    found.set(canonical, { name: name.trim(), canonical, kind, weight });
  };

  // 1. Quoted phrases: the user drawing the boundary by hand.
  let remainder = source.replace(
    /["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/gu,
    (m, inner) => {
      add(inner, WEIGHT_QUOTED, "work");
      // Blank the span so its words are not also counted as loose text below.
      return " ".repeat(m.length);
    }
  );

  // 2. Runs of capitalised words, sentence by sentence so that the first word
  //    of each sentence can be discounted — its capital is grammar, not a name.
  //
  //    Anything counted here is blanked as well, for the same reason a quoted
  //    span is: a word that has already been counted inside a name must not be
  //    counted a second time as a loose word. Left in, "Vannevar Bush" produced
  //    the name and then `vannevar` and `bush` beside it, which is one mention
  //    reported as three and pollutes every ranking downstream. A capital that
  //    was *not* counted — a single word at the start of a sentence — is left
  //    alone deliberately, so it still reaches step 3 as ordinary text.
  const consumed = [];
  let searchedTo = 0;
  for (const sentence of remainder.split(/(?<=[.!?])\s+/u)) {
    // `split` drops the whitespace it matched, so a sentence's offset in the
    // source has to be recovered rather than accumulated from the pieces.
    const start = remainder.indexOf(sentence, searchedTo);
    searchedTo = start + sentence.length;
    const proper = /(\p{Lu}[\p{L}\p{N}'’-]*(?:\s+\p{Lu}[\p{L}\p{N}'’-]*)*)/gu;
    for (const match of sentence.matchAll(proper)) {
      const phrase = match[1];
      const atSentenceStart = match.index === 0;
      const multiword = /\s/u.test(phrase);
      if (multiword) {
        add(phrase, WEIGHT_PROPER_PHRASE);
      } else if (!atSentenceStart) {
        add(phrase, WEIGHT_PROPER);
      } else {
        continue;
      }
      consumed.push([start + match.index, phrase.length]);
    }
  }
  for (const [at, length] of consumed) {
    remainder =
      remainder.slice(0, at) +
      " ".repeat(length) +
      remainder.slice(at + length);
  }

  // 3. Everything else that is not a stopword.
  for (const word of tokenise(remainder)) {
    add(word, WEIGHT_PLAIN);
  }

  return [...found.values()].sort(
    (a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical)
  );
}

/**
 * What a visit amounted to.
 *
 * `saved` is an explicit act and outranks any duration — a page saved after two
 * seconds was not bounced off, and the whole point of separating the three is
 * that the user's own statement beats the clock.
 *
 * @param {object} visit
 * @param {?number} visit.dwellMs Foreground time only.
 * @param {boolean} [visit.saved] Whether the user explicitly kept the page.
 * @param {number} [visit.readThresholdMs] Override for `READ_DWELL_MS`.
 * @returns {string} `bounced` | `read` | `saved`.
 */
export function deriveOutcome({
  dwellMs,
  saved = false,
  readThresholdMs = READ_DWELL_MS,
} = {}) {
  if (saved) {
    return "saved";
  }
  return Number(dwellMs) >= readThresholdMs ? "read" : "bounced";
}
