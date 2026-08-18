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
 *   5. everything else, by **Places frecency**, which stays as the floor.
 *
 * Two properties follow, and both are the point:
 *
 * - Every tier is explainable to the user in one line, and the bar prints that
 *   line as the group heading. Frecency has never been explainable.
 * - Every tier boundary is falsifiable. Either the page is in the context or
 *   it is not; there is no threshold to argue about. The only score in the
 *   whole ranking is in the last tier, and it is one this project did not
 *   invent.
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
 * An empty bar shows the twelve verbs, not a list of pages. That decision was
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
export const T_HISTORY = "history";

/** The order tiers are offered in. Exported so a test can assert it. */
export const TIER_ORDER = Object.freeze([
  T_MARK,
  T_CONTEXT,
  T_TRAIL,
  T_CROSSING,
  T_HISTORY,
]);

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
 * Rank everything on offer for a query.
 *
 * Rows within a tier are never re-sorted. `contextContents` already returns
 * pages best-outcome-first and that ordering is the tier's own claim; sorting
 * it again here would be this module inventing a second opinion about an order
 * the store has already justified.
 *
 * @param {string} query What the user has typed.
 * @param {object} sources
 * @param {object[]} [sources.marked] Pages the typed token addresses directly.
 * @param {object[]} [sources.context] Pages in the active context.
 * @param {object[]} [sources.trail] Pages on the active trail.
 * @param {object[]} [sources.crossings] Pages other trails reached.
 * @param {object[]} [sources.history] Places rows, already frecency-ordered.
 * @param {object} [options]
 * @param {number} [options.limit] How many rows at most.
 * @returns {object[]} Rows, in tier order, deduplicated by URL.
 */
export function suggestionsFor(
  query,
  { marked = [], context = [], trail = [], crossings = [], history = [] } = {},
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
      // asked to match the text as well. Every other tier is a guess and has
      // to earn its place by answering what was typed.
      if (tier !== T_MARK && !pageMatches(text, page)) {
        continue;
      }
      seen.add(key);
      rows.push(rowFor(tier, page, rows.length));
    }
  }

  return rows;
}
