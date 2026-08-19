/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Which of a page's links get a letter, and what they are called.
 *
 * The addressing itself is `FOSMarks`; this is the part that has to decide what
 * is worth addressing, and it is separated from the actor that walks the DOM so
 * that the decisions can be tested without a page. The actor's job is reduced
 * to producing candidates and drawing what comes back.
 *
 * Three rules, and the third is the one that had to be chosen rather than
 * derived.
 */

import { MARK_LETTERS } from "./FOSMarks.sys.mjs";

/**
 * How many links can carry a letter at once.
 *
 * Not a tuning parameter — it is the size of the alphabet, and it is stated in
 * terms of the alphabet so that it cannot drift from it.
 */
export const HINT_LIMIT = MARK_LETTERS.length;

/**
 * The label a link answers to.
 *
 * Read in the order a person reads the link: its own text, then the text an
 * assistive technology would announce for it, then the host it points at. The
 * middle two exist because an image link and an icon link have no text at all,
 * and they are exactly the links a hands-free user most needs a name for — a
 * mark whose letter came from nothing is a mark nobody can guess.
 *
 * The label is not decoration. `MarkRegistry` derives the letter from it, so a
 * link reading "Downloads" prefers `d`, which is the property that makes a mark
 * guessable before it has been learned. Getting this wrong does not make the
 * link unreachable; it makes it unmemorable, which over a session is worse.
 *
 * **A label with no letter in it is not a label**, and that is why the chain
 * tests for one rather than for emptiness. The icon link that a first draft of
 * this got wrong is `<a aria-label="Demonstration">▶</a>`, which is how icon
 * links are actually written: the glyph is real text, so `textContent` is not
 * empty, so a chain testing emptiness stops there and derives a mnemonic from a
 * character that is not in any alphabet. The link then gets whatever letter
 * happened to be free — precisely the arbitrary assignment `preferenceOrder`
 * exists to avoid, and on precisely the links that need a guessable name most,
 * because there is nothing on screen to read.
 *
 * The unusable candidate is still returned if nothing better turns up, since a
 * badge reading "▶" beside the mark is better than a blank row in the bar.
 *
 * @param {object} parts
 * @param {string} [parts.text] The link's own text content.
 * @param {string} [parts.aria] `aria-label`, or an image's `alt`, or `title`.
 * @param {string} [parts.host] The host of the target, as a last resort.
 * @returns {string} A label, possibly empty.
 */
export function labelFor({ text = "", aria = "", host = "" } = {}) {
  const candidates = [
    collapse(text),
    collapse(aria),
    // Stripped of the `www.` nobody says out loud, so that a bare host link
    // prefers a letter from the name rather than from the prefix every host
    // shares — the same failure the trail rail hit when node labels came from
    // "https://" and the first four nodes of a session took h, t, p and s.
    collapse(host).replace(/^www\./, ""),
  ];
  return (
    candidates.find(c => MNEMONIC.test(c)) ?? candidates.find(Boolean) ?? ""
  );
}

/**
 * Whether a label carries a letter a mark could be derived from.
 *
 * The alphabet, not "a word": `MARK_LETTERS` is what `preferenceOrder` matches
 * against, so this asks the same question that will be asked of the label a
 * moment later rather than a similar one.
 */
const MNEMONIC = new RegExp(`[${MARK_LETTERS.join("")}]`, "i");

function collapse(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choose the links to mark, in the order they should be assigned letters.
 *
 * Assignment order matters because the first candidate to ask for a letter gets
 * its pick of them, and `MarkRegistry` picks mnemonically. So whatever comes
 * first here gets the guessable marks.
 *
 * **One mark per destination.** Two links to the same URL — the thumbnail and
 * the headline above it, the icon and the name beside it — are one thing to a
 * user and were two hints in every tool that has drawn hints. Merging them is
 * free here and buys back letters on exactly the pages that need them most,
 * because a page dense enough to run out of alphabet is usually dense because
 * it is a list of articles each linked twice.
 *
 * **Document order.** Not visual order: document order is what a screen reader
 * announces and what Tab follows, so it is the order this browser is already
 * teaching, and it needs no bucketing constant to approximate a row. Where they
 * disagree the page's markup is usually the one telling the truth.
 *
 * **The first twenty-six, and the rest are told about.** `GRAMMAR.md` §2 says
 * marks go to what is on screen and the rest are reached by search, which is
 * the right rule and does not finish the job here: a page can have eighty links
 * on screen at once, and something still has to choose. Document order means a
 * long navigation menu can spend the whole alphabet before the article starts,
 * which is a real cost and is not hidden — the count of what was left unmarked
 * is returned so the caller can say it. A silent truncation would read as "these
 * are the links", and a user who cannot see the page has no way to find out
 * otherwise.
 *
 * @param {object[]} candidates `{id, label, href}`, in document order.
 * @param {object} [options]
 * @param {number} [options.limit] Defaults to the alphabet.
 * @returns {object} `{marked, total, dropped}` — the chosen candidates, how
 *   many distinct destinations were offered, and how many got no letter.
 */
export function chooseMarkable(candidates, { limit = HINT_LIMIT } = {}) {
  const byHref = new Map();
  const distinct = [];
  for (const candidate of candidates ?? []) {
    const href = candidate?.href ?? "";
    if (!href) {
      // No destination to merge on, so it can only be itself.
      distinct.push({ ...candidate, aliases: [] });
      continue;
    }
    const first = byHref.get(href);
    if (first) {
      // The later one still gets a hint drawn on it, pointing at the same
      // letter. Hiding it would leave a visibly clickable thing with no mark,
      // which reads as "this one is not reachable" rather than as "these two
      // are the same".
      first.aliases.push(candidate.id);
      continue;
    }
    const entry = { ...candidate, aliases: [] };
    byHref.set(href, entry);
    distinct.push(entry);
  }

  const marked = distinct.slice(0, limit);
  return {
    marked,
    total: distinct.length,
    dropped: Math.max(0, distinct.length - marked.length),
  };
}

/**
 * The sentence said after `follow` with no target.
 *
 * Here rather than in the surface because it is the one part of the answer that
 * is a judgement about what the user needs to know, and it is worth a test. The
 * truncated case names both numbers: "26 links marked" on a page of eighty is
 * true and useless, because it is the forty-something missing ones that decide
 * whether the user goes on speaking or reaches for the mouse.
 *
 * @param {object} outcome The result of `chooseMarkable`.
 * @param {object[]} outcome.marked The links that got a letter.
 * @param {number} outcome.total How many distinct destinations were offered.
 * @param {number} outcome.dropped How many got no letter.
 * @returns {string}
 */
export function markedMessage({ marked, total, dropped }) {
  if (!total) {
    return "No links on this page.";
  }
  const n = marked.length;
  const links = n === 1 ? "link" : "links";
  return dropped
    ? `${n} of ${total} ${links} marked. ${dropped} could not be: there are only twenty-six letters.`
    : `${n} ${links} marked.`;
}
