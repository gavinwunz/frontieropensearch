/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the command bar offers, and in what order.
 *
 * This is pillar C's third surface: the phase plan asks that the bar rank
 * suggestions "by *active context*, not global frecency". This module is that
 * ranking, and it is a pure function of rows already read, so it is tested in
 * node. Everything that touches SQLite or Places is in the engine.
 *
 * ---
 *
 * WHY TIERS AND NOT A SCORE
 *
 * The obvious implementation is one number per candidate mixing context
 * membership, recency, dwell, outcome and frecency, tuned until the list looks
 * right. That is how frecency itself was built, and Mozilla has since said in
 * public that frecency's twenty-two weights "were not decided on in a
 * data-driven way". When they did decide them with data — a federated-learning
 * experiment across 723,581 users, optimising all twenty-two — the win was
 * **0.6 of a character typed**. That is the entire remaining headroom in the
 * signal Firefox has ranked by for fifteen years, and it is the strongest
 * available argument that the answer here is a *different signal*, not better
 * coefficients. Inventing twenty-two new magic numbers in an afternoon would be
 * strictly worse than the ones we would be replacing.
 *
 * So the order is tiers, and each tier boundary is a fact rather than a
 * coefficient:
 *
 *   1. a **mark**, typed as a mark — an address, not a guess;
 *   2. pages **in the active context**, best outcome first;
 *   3. pages on the **active trail** the context has not claimed;
 *   4. **crossings** — pages another trail reached that this context also
 *      reached, which is the memex's compounding effect made rankable;
 *   5. pages **close in meaning** to what was typed, which is the one tier
 *      that is a score rather than a fact — see below;
 *   6. everything else, by **Places frecency**, which stays as the floor.
 *
 * Two properties follow, and both are the point:
 *
 * - Every tier is explainable to the user in one line, and the bar prints that
 *   line as the group heading. Frecency has never been explainable.
 * - Every tier boundary is falsifiable. Either the page is in the context or
 *   it is not.
 *
 * WHY ONE TIER HAS A THRESHOLD AFTER ALL
 *
 * This file used to be able to say there was no threshold anywhere but the
 * floor. Tier 5 spends that, and it is worth being plain about why rather than
 * quietly widening the claim.
 *
 * The rest of the ranking rests on `pageMatches`, which requires every typed
 * term to appear in the title or the URL. Measuring that predicate against
 * real queries found it does not merely rank those pages badly — for **11 of
 * 32** queries it scores every candidate identically at zero, so a third of
 * what a user types produces no ordering at all and whatever the store
 * returned first wins. A tier that recovers those queries is worth one
 * threshold.
 *
 * What keeps it honest is that the threshold is *measured* rather than tuned:
 * `RELATED_FLOOR` is where the same experiment found "same enquiry" best
 * separates from "not", and re-running `agent/jobs/run36.sh` re-derives it. It
 * is one number with a stated precision and recall, which is a different kind
 * of object from twenty-two coefficients nobody can account for — and it buys
 * a tier that only ever offers, never acts.
 *
 * WHY THE FLOOR STAYS
 *
 * A browser that cannot find a page you visited once last year is worse than
 * Firefox, and this fork's claim is not that history should be lost. Tier 5 is
 * therefore not a fallback for when the good tiers are empty — it is always
 * consulted, and it always sorts last.
 *
 * WHY THERE IS NO ZERO-PREFIX LIST
 *
 * An empty bar shows the fifteen verbs, not a list of pages. That decision was
 * taken when the bar was built (this is the only surface that can teach the
 * vocabulary, because there are no menus), and nothing found since argues
 * against it: zero-prefix suggestion lists as practised are ranked from a cache
 * of recent and recurring queries, and recency is the signal this project
 * already rejected for deciding what belongs to a context. A page becomes
 * offerable when there is a query to match it against.
 */

import { markWord } from "./FOSMarks.sys.mjs";

/** Tier ids, most specific claim first. */
export const T_MARK = "mark";
export const T_CONTEXT = "context";
export const T_TRAIL = "trail";
export const T_CROSSING = "crossing";
export const T_RELATED = "related";
export const T_HISTORY = "history";

/** The order tiers are offered in. Exported so a test can assert it. */
export const TIER_ORDER = Object.freeze([
  T_MARK,
  T_CONTEXT,
  T_TRAIL,
  T_CROSSING,
  T_RELATED,
  T_HISTORY,
]);

/**
 * How close a page has to be to what was typed before it is worth offering.
 *
 * This is a measured number, not a taste: `browser_zzembedquality.js` sweeps
 * every observed pair similarity over eight enquiries and reports where "the
 * same enquiry" best separates from "not". At the dimension this fork ships,
 * for the comparison this tier actually makes, that is **0.173** — precision
 * 0.708, recall 0.656. Below it a pair is more likely to be unrelated than
 * related, and a row the user has to read and reject is worse than a shorter
 * list.
 *
 * **Which comparison, specifically.** The first version of this constant was
 * 0.169, taken from the query→query distribution, and it was applied to a tier
 * that only ever compares a query to a *title*. Those are different
 * distributions from the same model — at d256 the query→title threshold is
 * 0.173 and the query→query one is 0.201 — and nothing about the code said
 * which one it was using. Run 37 caught it by driving the tier in a browser
 * and watching a page fail to be offered at 0.159. A threshold is only
 * measured if you can say what it was measured over.
 *
 * The same measurement is why this tier only ever *offers*. Seven in ten right
 * is a good list and a bad automatic decision, so nothing above this floor is
 * acted on without the user picking it.
 */
export const RELATED_FLOOR = 0.173;

/**
 * The one line each tier is explained by, shown as the group heading.
 *
 * These are the user-facing form of the tier boundary, so they say what is
 * true of every row beneath them and nothing more.
 */
export const TIER_LABELS = Object.freeze({
  [T_MARK]: "Marked",
  [T_CONTEXT]: "In this context",
  [T_TRAIL]: "On this trail",
  [T_CROSSING]: "Another trail reached this",
  [T_RELATED]: "Close to what you typed",
  [T_HISTORY]: "Visited before",
});

/** The row kind, so the bar can tell a page from an action word. */
export const R_PAGE = "page";

/**
 * How many pages the bar offers at once.
 *
 * Firefox's own default is ten results (`browser.urlbar.maxRichResults`), and
 * this bar spends some of that budget on action-word completions, so eight
 * leaves room for the list to teach as well as answer.
 */
export const DEFAULT_LIMIT = 8;

/**
 * Whether a page answers what has been typed.
 *
 * Every term must appear somewhere in the title or the URL. Substring rather
 * than prefix, because a trail node's title is a whole page title and the word
 * the user remembers is very often in the middle of it.
 *
 * The same predicate is applied to every tier, including the Places floor,
 * which is deliberate: if matching differed between tiers then the tier
 * boundary would not be the only thing deciding the order, and the ranking
 * would stop being explainable.
 *
 * @param {string} query What the user has typed.
 * @param {object} page A candidate, with `url` and optional `title`.
 * @returns {boolean}
 */
export function pageMatches(query, page) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) {
    return false;
  }
  const haystack = `${page?.title ?? ""} ${page?.url ?? ""}`.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

/**
 * A URL is one page however many trails reached it.
 *
 * @param {object} page A candidate row.
 * @returns {string} What deduplication compares.
 */
function keyOf(page) {
  return String(page?.url ?? "");
}

/**
 * The bit of a URL worth showing when there is no better provenance.
 *
 * @param {string} url
 * @returns {string} The host, or the whole string if there is not one.
 */
function hostOf(url) {
  // Deliberately not `new URL()`: this module is pure so that it runs in node
  // without Gecko, and a malformed row must produce a dull detail line rather
  // than throw inside the bar's render.
  const match = /^[a-z0-9+.-]+:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(
    String(url ?? "")
  );
  return match ? match[1].replace(/^www\./, "") : String(url ?? "");
}

/**
 * The provenance line shown beside a page: the tier made concrete.
 *
 * @param {string} tier Which tier the row came from.
 * @param {object} page The row.
 * @returns {string} What the row says about itself.
 */
function detailFor(tier, page) {
  switch (tier) {
    case T_MARK:
      return page.title ? hostOf(page.url) : "";
    case T_CONTEXT: {
      // The outcome is the strongest thing the engine knows about a page it
      // has already seen, and it is the reason this tier is ordered as it is,
      // so it is what the row says.
      const outcome =
        page.outcome && page.outcome !== "unvisited" ? page.outcome : null;
      return [outcome, hostOf(page.url)].filter(Boolean).join(" · ");
    }
    case T_CROSSING:
      return [page.trail_name || "an unnamed trail", hostOf(page.url)].join(
        " · "
      );
    case T_RELATED:
      // A related row shares no words with the query by construction, so the
      // host on its own says nothing about why it is here. Where it came from
      // does, and it is the same provenance every other tier shows.
      return [page.trail_name, hostOf(page.url)].filter(Boolean).join(" · ");
    default:
      return hostOf(page.url);
  }
}

/**
 * Build one offer row from a store or Places row.
 *
 * @param {string} tier Which tier it came from.
 * @param {object} page The row.
 * @param {number} index Its position within the tier, for a stable id.
 * @returns {object} A row the command bar can render and act on.
 */
function rowFor(tier, page, index) {
  const url = String(page.url ?? "");
  const letter = page.mark ?? null;
  return {
    kind: R_PAGE,
    tier,
    // Stable across a re-render of the same list, which is what lets the bar
    // keep a user's selection anchored when a later read arrives.
    id: `page-${tier}-${index}`,
    key: url,
    label: page.title?.trim() || url,
    detail: detailFor(tier, page),
    group: TIER_LABELS[tier],
    url,
    // The database row id, and the mark if the page has one. Both may be null:
    // a page from Places has never been on a trail, and a page from an older
    // trail this session did not restore has a row but no mark.
    nodeId: page.id ?? page.node_id ?? null,
    mark: letter,
    spoken: letter ? markWord(letter) : null,
  };
}

/**
 * Cosine similarity between two equal-length vectors.
 *
 * Kept here rather than beside the engine that produces the vectors because
 * this module is where a tier's meaning lives, and it is pure, so the arithmetic
 * is tested in node without Gecko. Vectors arrive normalised from the static
 * backend, so the magnitudes below are usually 1 — they are computed anyway
 * because a caller passing an unnormalised vector should get the right answer
 * rather than a plausible one.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number} -1 to 1, or 0 when either side has no magnitude or the
 *   lengths disagree.
 */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    leftSquares += a[i] * a[i];
    rightSquares += b[i] * b[i];
  }
  const magnitude = Math.sqrt(leftSquares) * Math.sqrt(rightSquares);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * The `related` source, built from vectors.
 *
 * A page is a candidate only when it *failed* `pageMatches`: the tiers above
 * have already offered everything that answered the words, so anything this
 * would re-offer is a duplicate the dedup would drop anyway, and embedding it
 * is work with no possible outcome.
 *
 * The text compared is the title, not the URL. The measurement that set
 * `RELATED_FLOOR` scored query→title at p@1 0.938, and a URL is not prose —
 * its tokens are hostnames and slugs, which a bag-of-tokens model has no
 * useful row for. A page with no title is therefore not a candidate.
 *
 * @param {string} query What the user has typed.
 * @param {object[]} pages Candidates from any tier.
 * @returns {object[]} The subset worth embedding, in the order given.
 */
export function relatedCandidates(query, pages) {
  const text = String(query ?? "").trim();
  if (!text) {
    return [];
  }
  return (pages ?? []).filter(
    page => page?.title?.trim() && !pageMatches(text, page)
  );
}

/**
 * Rank everything on offer for a query.
 *
 * Rows within a tier are never re-sorted. `contextContents` already returns
 * pages best-outcome-first and that ordering is the tier's own claim; sorting
 * it again here would be this module inventing a second opinion about an order
 * the store has already justified.
 *
 * `related` is the one exception, and it is one for the same reason: there is
 * no other claim about that tier's order than the similarity itself, so this
 * module sorts it because nothing upstream has an opinion to defend. It is
 * also the only tier exempt from `pageMatches`, which is what it exists for —
 * a third of real queries share no word at all with the pages that answer
 * them, and a predicate that requires every term is silent on all of them.
 *
 * @param {string} query What the user has typed.
 * @param {object} sources
 * @param {object[]} [sources.marked] Pages the typed token addresses directly.
 * @param {object[]} [sources.context] Pages in the active context.
 * @param {object[]} [sources.trail] Pages on the active trail.
 * @param {object[]} [sources.crossings] Pages other trails reached.
 * @param {object[]} [sources.related] Pages close in meaning, each carrying a
 *   `similarity` in -1..1. Anything below `RELATED_FLOOR` is dropped here
 *   rather than upstream, so the floor is stated once.
 * @param {object[]} [sources.history] Places rows, already frecency-ordered.
 * @param {object} [options]
 * @param {number} [options.limit] How many rows at most.
 * @returns {object[]} Rows, in tier order, deduplicated by URL.
 */
export function suggestionsFor(
  query,
  {
    marked = [],
    context = [],
    trail = [],
    crossings = [],
    related = [],
    history = [],
  } = {},
  { limit = DEFAULT_LIMIT } = {}
) {
  const text = String(query ?? "").trim();
  if (!text) {
    return [];
  }

  const bySource = {
    [T_MARK]: marked,
    [T_CONTEXT]: context,
    [T_TRAIL]: trail,
    [T_CROSSING]: crossings,
    [T_RELATED]: related
      .filter(page => Number(page?.similarity) >= RELATED_FLOOR)
      .sort((left, right) => right.similarity - left.similarity),
    [T_HISTORY]: history,
  };

  const seen = new Set();
  const rows = [];

  for (const tier of TIER_ORDER) {
    for (const page of bySource[tier] ?? []) {
      if (rows.length >= limit) {
        return rows;
      }
      const key = keyOf(page);
      if (!key || seen.has(key)) {
        continue;
      }
      // A mark is an address: it was resolved by the mark rule, so it is not
      // asked to match the text as well. A related page has already answered
      // the text, by meaning rather than by spelling, and asking it for the
      // words as well would empty the tier. Everything else is a guess and has
      // to earn its place by answering what was typed.
      if (tier !== T_MARK && tier !== T_RELATED && !pageMatches(text, page)) {
        continue;
      }
      seen.add(key);
      rows.push(rowFor(tier, page, rows.length));
    }
  }

  return rows;
}
