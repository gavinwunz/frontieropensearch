/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The command bar's last tier: everything else, by Places frecency.
 *
 * The four tiers above this one are provenance — the store can say exactly why
 * each of their rows is being offered. This tier cannot, and it is here
 * anyway, because a browser that cannot find a page you visited once last year
 * is worse than Firefox and this fork has never claimed that history should be
 * lost. It is the floor, not the fallback: it is always read, and it always
 * sorts last.
 *
 * Two deliberate choices:
 *
 * - **Places' ordering, ours nothing.** The rows come back in whatever order
 *   Places currently ranks by, including its alternative frecency when that is
 *   the enabled experiment. Re-sorting them here would be this component
 *   inventing an opinion about a score it did not build.
 * - **Our matching, not `AUTOCOMPLETE_MATCH`.** Places ships a SQL function
 *   for this, and it carries the address bar's whole behaviour surface —
 *   restriction tokens, match-boundary modes, tag and bookmark weighting. The
 *   ranking above this tier applies one plain substring rule to every
 *   candidate, and a floor that matched by different rules than the tiers
 *   above it would break the property the tiers exist for: that the tier
 *   boundary is the only thing deciding the order.
 *
 * The connection is Places' own read-only one, so this reads history without
 * being able to alter it.
 *
 * Which is true of this file and was not true of the fork. What the ranking
 * read here is worth depends on what the fork *wrote* — a visit's frecency
 * turns on whether Places was told the chrome asked for the page — and that
 * declaration is made in `FOSActions.sys.mjs`, three modules away, where
 * nothing about this tier is in view. See `ARCHITECTURE.md` §7.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

/**
 * Escape LIKE's wildcards; `/` is the escape character used below.
 *
 * @param {string} text One search term.
 * @returns {string} The term, safe to interpolate into a LIKE pattern.
 */
function escapeForLike(text) {
  return text.replace(/[/%_]/g, "/$&");
}

/**
 * Pages matching every term, most frecent first.
 *
 * @param {string} query What the user typed.
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {Promise<object[]>} `{url, title, frecency}`, or empty.
 */
export async function frecencyMatches(query, { limit = 20 } = {}) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) {
    return [];
  }

  // Which column Places is currently ranking by. Reading its answer rather
  // than hardcoding `frecency` is what keeps this tier in step with the
  // browser's own ranking instead of quietly diverging from it.
  const field = lazy.PlacesUtils.history.isAlternativeFrecencyEnabled
    ? "alt_frecency"
    : "frecency";

  const params = { limit };
  const conditions = terms.map((term, i) => {
    params[`t${i}`] = `%${escapeForLike(term)}%`;
    return `(LOWER(h.url) LIKE :t${i} ESCAPE '/'
             OR LOWER(h.title) LIKE :t${i} ESCAPE '/')`;
  });

  let connection;
  try {
    connection = await lazy.PlacesUtils.promiseDBConnection();
  } catch (e) {
    // A profile whose Places database failed to open still gets four working
    // tiers. The floor is the one tier this component does not own, so it is
    // also the one tier allowed to be missing.
    console.error(e);
    return [];
  }

  const rows = await connection.executeCached(
    `SELECT h.url, h.title, h.${field} AS frecency
     FROM moz_places h
     WHERE h.hidden = 0 AND h.${field} > 0 AND ${conditions.join(" AND ")}
     ORDER BY h.${field} DESC, h.last_visit_date DESC
     LIMIT :limit`,
    params
  );

  return rows.map(row => ({
    url: row.getResultByName("url"),
    title: row.getResultByName("title"),
    frecency: row.getResultByName("frecency"),
  }));
}
