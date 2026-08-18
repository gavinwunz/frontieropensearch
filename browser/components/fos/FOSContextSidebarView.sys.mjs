/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The context sidebar's view model: what the engine knows, arranged to be read.
 *
 * Pure and free of Gecko APIs, like `FOSTrailRailView` and `FOSCommandBarView`.
 * `FOSContextSidebar.sys.mjs` renders what this returns; `FOSContextStore`
 * produces the rows it is given, unchanged — this file decides what appears,
 * in what order, and what each row says.
 *
 * SCHEMA.md calls this the second of pillar C's three surfaces: "what you know
 * so far" about the context you are in. The closest thing anyone has actually
 * evaluated is SearchBar (Morris, Morris & Venolia, CHI 2008), a permanent pane
 * capturing queries and the pages visited after them, and four of its findings
 * are load-bearing here rather than decorative — see IDEAS.md for the numbers.
 *
 * 1. **Every row is live.** Participants performed 31.5% of their
 *    re-navigations and 31.7% of their re-queries by clicking rows in the pane,
 *    rising to 42.2% of re-navigations in the second week. A pane of text would
 *    have thrown that away. So every row here carries the node it re-enters,
 *    and a row that cannot be entered says so rather than looking clickable.
 *
 * 2. **There is no notes field.** SearchBar had one and it was the lowest-rated
 *    part of the tool, 3.0 against 4.5 for topic organisation and 4.0 for the
 *    per-topic summary. A sidebar like this is under permanent temptation to
 *    grow a scratchpad; the one study that shipped one found nobody wanted it.
 *
 * 3. **Nothing here asks to be organised.** SearchBar's topics were created by
 *    hand and that was its one real failure — median 4.0 for "it was difficult
 *    to remember to create a new topic", and three of eight participants made
 *    none at all. Contexts are seeded by provenance and cost the user nothing,
 *    so this surface must be worth reading having been given no curation
 *    whatsoever. Every section below fills itself.
 *
 * 4. **It is built to be read after a week, not after ten minutes.** The pane
 *    rated 3.5 for usefulness in its first session and 5.0 in the second, a
 *    week later. Hence the relative times on questions and the crossing rows:
 *    both answer "what was I doing", which is not a question anyone asks about
 *    the last ten minutes.
 */

import { markWord } from "./FOSMarks.sys.mjs";

/** Entities below this weight are noise rather than a topic. */
const ENTITY_FLOOR = 0.5;

/** How many entities the "About" section will show. */
const ENTITY_LIMIT = 12;

/**
 * @param {number} n
 * @param {string} noun Singular.
 * @returns {string} `1 page`, `3 pages`.
 */
export function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A coarse relative time, for a surface read days after the fact.
 *
 * Deliberately coarse: the question a resumed context answers is "was this the
 * same afternoon or another week", and a precise timestamp reads as data rather
 * than as memory. Anything under a minute is "just now" because a question
 * asked seconds ago does not need a time at all.
 *
 * @param {?number} then Unix ms, or null.
 * @param {number} now Unix ms.
 * @returns {string} Empty when `then` is null.
 */
export function relativeTime(then, now) {
  if (!then) {
    return "";
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "last week" : `${weeks}w ago`;
}

/**
 * How long a page was held, in words.
 *
 * @param {?number} ms
 * @returns {string} Empty when there is no reading to report.
 */
export function dwellLabel(ms) {
  if (!ms || ms < 1000) {
    return "";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/**
 * The one-sentence answer to "what do you have on this?".
 *
 * Lives here rather than in the engine so that the sentence `what` speaks and
 * the heading the sidebar shows are the same string from the same code. They
 * are the same claim, and two of them would eventually disagree — the same
 * argument that put `contextContents` behind both `what` and `pack`.
 *
 * @param {?object} contents From `FOSContextStore.contextContents`.
 * @returns {string}
 */
export function summariseContents(contents) {
  if (!contents) {
    return "No context yet — browse or search and one will start.";
  }
  const { context, queries, pages, entities } = contents;
  const label = context.label?.trim() || "an unnamed context";
  const read = pages.filter(
    page => page.outcome === "read" || page.outcome === "saved"
  ).length;
  const topics = entities
    .filter(entity => entity.weight >= ENTITY_FLOOR)
    .slice(0, 5)
    .map(entity => entity.name);
  const parts = [
    `${label}: ${plural(queries.length, "question")}, ` +
      `${plural(pages.length, "page")}, ${read} read`,
  ];
  if (topics.length) {
    parts.push(`about ${topics.join(", ")}`);
  }
  return parts.join(" — ");
}

/**
 * The other trails that have reached the page you are on.
 *
 * This is the memex's compounding effect made visible, and it is the row this
 * surface exists for: `trail_node` is a visit rather than a document, so one
 * URL is already many rows across many trails, and arriving somewhere by one
 * line of enquiry is how you find out it answers another. Nothing else in this
 * browser can tell you that, because no other surface holds more than one trail
 * at a time.
 *
 * The trail you are already on is excluded — it is not news that this page is
 * on the trail you are looking at — and a trail that reached the page more than
 * once is one row, at its earliest arrival, because the claim is "this trail
 * came here", not "this trail came here four times".
 *
 * @param {object[]} crossings Rows from `FOSContextStore.crossings`.
 * @param {?number} currentTrailId The trail the user is on, excluded.
 * @param {number} now Unix ms.
 * @returns {object[]} Rows, earliest arrival first.
 */
export function crossingRows(crossings, currentTrailId, now) {
  const byTrail = new Map();
  for (const crossing of crossings) {
    if (crossing.trail_id === currentTrailId) {
      continue;
    }
    const seen = byTrail.get(crossing.trail_id);
    if (!seen || crossing.created_at < seen.created_at) {
      byTrail.set(crossing.trail_id, crossing);
    }
  }
  return [...byTrail.values()]
    .sort((a, b) => a.created_at - b.created_at)
    .map(crossing => ({
      kind: "crossing",
      nodeId: crossing.node_id,
      trailId: crossing.trail_id,
      // An unnamed trail is named for what it is rather than for its id, the
      // same fallback the rail's breadcrumb uses.
      label: crossing.trail_name?.trim() || "an unnamed trail",
      named: !!crossing.trail_name?.trim(),
      detail: relativeTime(crossing.created_at, now),
      enterable: true,
    }));
}

/**
 * The whole sidebar, as sections of rows.
 *
 * @param {?object} contents From `FOSContextStore.contextContents`.
 * @param {object} [options]
 * @param {object[]} [options.crossings] Rows from `crossings(currentUrl)`.
 * @param {?number} [options.currentTrailId] The trail the user is on.
 * @param {?number} [options.currentNodeId] The node the user is on, marked.
 * @param {?string} [options.mark] The active context's own mark, if named.
 * @param {?object} [options.marks] A `markOf(nodeId)` lookup, or null.
 * @param {number} [options.now] Unix ms.
 * @returns {object} `{title, named, mark, summary, sections, empty}`.
 */
export function sidebarFor(
  contents,
  {
    crossings = [],
    currentTrailId = null,
    currentNodeId = null,
    mark = null,
    marks = null,
    now = Date.now(),
  } = {}
) {
  if (!contents) {
    return {
      title: "No context yet",
      named: false,
      mark: null,
      summary: summariseContents(null),
      sections: [],
      empty: "Browse or search and a context starts here.",
    };
  }

  const { context, queries, pages, entities } = contents;
  const markOf = id => marks?.markOf?.(id) ?? null;
  const sections = [];

  // Crossings lead, when there are any. They are the least expected thing on
  // the surface and the only row that is about the page rather than the
  // context, so burying them under a long page list would waste them.
  const crossed = crossingRows(crossings, currentTrailId, now);
  if (crossed.length) {
    sections.push({
      id: "crossings",
      title: "This page is also on",
      note: `You have reached this page from ${plural(
        crossed.length + 1,
        "trail"
      )}.`,
      rows: crossed,
    });
  }

  if (queries.length) {
    sections.push({
      id: "questions",
      title: "Questions asked",
      rows: queries.map(query => ({
        kind: "query",
        queryId: query.id,
        nodeId: query.trail_node_id ?? null,
        label: query.raw,
        // The normalised intent is what the engine matched on, so showing it
        // is showing the user what the machine thinks they asked. It goes in
        // the tooltip rather than the row: it is an explanation, and an
        // explanation nobody asked for is clutter.
        detail: relativeTime(query.created_at, now),
        title: query.normalised_intent ?? query.raw,
        spoken: query.input_mode === "voice",
        // A question that opened nothing is still worth showing — an abandoned
        // line of enquiry is a thing you did — but it must not look clickable.
        enterable: query.trail_node_id != null,
      })),
    });
  }

  if (pages.length) {
    sections.push({
      id: "pages",
      title: "Pages",
      // Left in the order the store returned: best outcome first, then
      // earliest. Re-sorting here would put the ranking in two places.
      rows: pages.map(page => ({
        kind: "page",
        nodeId: page.id,
        label: page.title?.trim() || hostOf(page.url),
        title: page.url,
        detail: [dwellLabel(page.dwell_ms), page.trail_name?.trim()]
          .filter(Boolean)
          .join(" · "),
        outcome: page.outcome,
        // A dismissed card is not a deleted page — the rail shows dismissed
        // rows for exactly this reason, and so does this.
        dismissed: page.dismissed_at != null,
        current: page.id === currentNodeId,
        // The letter the page already holds, if it holds one. Never a letter
        // of this row's own: see IDEAS.md on why a sidebar row does not get a
        // mark of its own.
        mark: markOf(page.id),
        enterable: true,
      })),
    });
  }

  const topics = entities
    .filter(entity => entity.weight >= ENTITY_FLOOR)
    .slice(0, ENTITY_LIMIT);
  if (topics.length) {
    sections.push({
      id: "entities",
      title: "About",
      rows: topics.map(entity => ({
        kind: "entity",
        label: entity.name,
        title: `${entity.kind} — mentioned ${plural(entity.mentions, "time")}`,
        detail: "",
        // Entities are not places. Nothing to enter, and the row says so by
        // being the one kind that is never clickable.
        enterable: false,
      })),
    });
  }

  const label = context.label?.trim();
  return {
    title: label || "Unnamed context",
    named: !!label,
    mark,
    markWord: mark ? markWord(mark) : null,
    summary: summariseContents(contents),
    sections,
    empty: sections.length
      ? null
      : "Nothing recorded here yet. Ask something, or open a page.",
  };
}

/**
 * The host of a URL, as a last-resort label.
 *
 * @param {string} url
 * @returns {string} Never empty.
 */
function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch (e) {
    return url;
  }
}

/**
 * Move a selection through the enterable rows of a rendered sidebar.
 *
 * Rows that cannot be entered are skipped rather than selected and refused: an
 * arrow key that lands on a dead row costs the keyboard user a press to find
 * that out, and the rule "the selection is always something you can act on" is
 * what makes Enter safe to press without looking.
 *
 * @param {object[]} rows Every row on the surface, in rendered order.
 * @param {?number} index The current index, or null.
 * @param {number} delta +1 or -1.
 * @returns {?number} The new index, or null when nothing is enterable.
 */
export function moveSelection(rows, index, delta) {
  const usable = rows
    .map((row, i) => (row.enterable ? i : -1))
    .filter(i => i >= 0);
  if (!usable.length) {
    return null;
  }
  if (index === null) {
    return delta > 0 ? usable[0] : usable[usable.length - 1];
  }
  const position = usable.indexOf(index);
  if (position === -1) {
    // The selection is on a row that is no longer enterable: take the next
    // usable row in the direction of travel rather than jumping to an end.
    const next = usable.find(i => i > index);
    return delta > 0
      ? (next ?? usable[0])
      : (usable.findLast(i => i < index) ?? usable[usable.length - 1]);
  }
  const moved = position + delta;
  // Stops at the ends rather than wrapping, like the rail: a list you can fall
  // off the bottom of and reappear at the top of hides how long it is.
  return usable[Math.max(0, Math.min(usable.length - 1, moved))];
}
