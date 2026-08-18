/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * "Export context pack" — one context as a markdown brief.
 *
 * The output has one audience and it is not a person browsing their own
 * history: it is written to be pasted into a language model as the opening
 * context of a conversation. That decides every formatting question here.
 *
 *   - It leads with what was being worked out, because a model reads the top of
 *     its context best and the questions are the task.
 *   - Pages are ordered by what happened to them, not by when they were seen. A
 *     page that was read for four minutes is worth more of a limited context
 *     window than one bounced off in two seconds, and this is the one place
 *     that judgement can be applied — a raw history export cannot make it,
 *     which is most of why this exists.
 *   - It says plainly what it is and where it came from, so the model is not
 *     left inferring whether these are the user's claims or someone else's.
 *
 * A pure function over the rows `FOSContextStore.contextContents` returns, so
 * it is tested under `node --test` with no database and no browser.
 */

/** How many entities are worth carrying into a brief. */
const ENTITY_LIMIT = 20;

/** Below this weight an entity is noise from a page title, not a topic. */
const ENTITY_FLOOR = 0.5;

/** Section headings, in the order they appear. */
const OUTCOME_SECTIONS = [
  ["saved", "Saved"],
  ["read", "Read"],
  ["bounced", "Skimmed or abandoned"],
  ["unvisited", "Opened, no visit recorded"],
];

/**
 * Render a context as a markdown brief.
 *
 * @param {object} contents From `FOSContextStore.contextContents`.
 * @param {object} [options]
 * @param {?number} [options.now] Unix ms stamped on the brief; omit for none.
 * @param {number} [options.entityLimit]
 * @returns {string} Markdown.
 */
export function buildContextPack(
  contents,
  { now = null, entityLimit = ENTITY_LIMIT } = {}
) {
  if (!contents?.context) {
    throw new Error("buildContextPack: no context");
  }
  const { context, queries = [], pages = [], entities = [] } = contents;
  const title = context.label?.trim() || "Untitled context";
  const out = [];

  out.push(`# Context pack — ${title}`);
  out.push("");
  out.push(summarise({ title, queries, pages, now }));
  out.push("");

  out.push("## Questions asked");
  out.push("");
  if (queries.length) {
    // Raw, not normalised. The normalised form exists for matching; how the
    // question was actually put carries intent that the cleaned-up form has
    // deliberately thrown away.
    for (const query of queries) {
      const spoken = query.input_mode === "voice" ? " _(spoken)_" : "";
      out.push(`- ${escapeInline(query.raw)}${spoken}`);
    }
  } else {
    out.push("_No queries recorded in this context._");
  }
  out.push("");

  out.push("## Pages");
  out.push("");
  if (pages.length) {
    for (const [outcome, heading] of OUTCOME_SECTIONS) {
      const group = pages.filter(page => page.outcome === outcome);
      if (!group.length) {
        continue;
      }
      out.push(`### ${heading}`);
      out.push("");
      for (const page of group) {
        out.push(`- ${pageLine(page)}`);
      }
      out.push("");
    }
  } else {
    out.push("_No pages in this context._");
    out.push("");
  }

  const keep = entities
    .filter(entity => Number(entity.weight) >= ENTITY_FLOOR)
    .slice(0, entityLimit);
  out.push("## Key entities");
  out.push("");
  if (keep.length) {
    for (const entity of keep) {
      const kind =
        entity.kind && entity.kind !== "term" ? ` (${entity.kind})` : "";
      const mentions = Number(entity.mentions) || 0;
      const seen = mentions === 1 ? "1 mention" : `${mentions} mentions`;
      out.push(`- **${escapeInline(entity.name)}**${kind} — ${seen}`);
    }
  } else {
    out.push("_Nothing above the salience floor._");
  }
  out.push("");

  out.push("---");
  out.push("");
  out.push(
    "Exported from the Frontier OpenSearch context engine. Everything above " +
      "was recorded locally on this machine from one person's browsing; none " +
      "of it has been checked against a source, and a page appearing here " +
      "means it was open, not that it was right."
  );
  out.push("");

  return out.join("\n");
}

/**
 * The opening paragraph: what this context is, in one sentence a model can use.
 *
 * @param {object} parts
 * @param {string} parts.title The context's label.
 * @param {object[]} parts.queries
 * @param {object[]} parts.pages
 * @param {?number} parts.now Unix ms, or null for no stamp.
 * @returns {string}
 */
function summarise({ title, queries, pages, now }) {
  const read = pages.filter(
    page => page.outcome === "read" || page.outcome === "saved"
  ).length;
  const bits = [
    `${count(queries.length, "question")} asked`,
    `${count(pages.length, "page")} opened`,
  ];
  if (read) {
    bits.push(`${read} read or saved`);
  }
  const stamp = now === null ? "" : ` Exported ${isoDay(now)}.`;
  return `Research context **${title}**: ${bits.join(", ")}.${stamp}`;
}

/**
 * @param {object} page A row from `contextContents().pages`.
 * @returns {string}
 */
function pageLine(page) {
  const label = escapeInline(page.title?.trim() || page.url);
  const parts = [`[${label}](${page.url})`];
  const dwell = Number(page.dwell_ms);
  if (dwell > 0) {
    parts.push(`— ${humanDuration(dwell)}`);
  }
  if (page.trail_name) {
    parts.push(`— trail "${escapeInline(page.trail_name)}"`);
  }
  return parts.join(" ");
}

/**
 * @param {number} n
 * @param {string} noun Singular.
 * @returns {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A duration a person can read. Deliberately coarse — the exact millisecond
 * count is noise in a brief, and rounding stops the output churning between
 * two exports of an unchanged context.
 *
 * @param {number} ms
 * @returns {string}
 */
function humanDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/**
 * @param {number} ms Unix ms.
 * @returns {string} `YYYY-MM-DD`.
 */
function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Neutralise markdown that arrived in a page title or a query.
 *
 * A page can call itself `[click here](http://elsewhere)` and a brief built by
 * pasting that straight in would carry a link the user never visited into a
 * model's context as though the engine had recorded it. This is an injection
 * surface even without a network: the text is attacker-controlled and the
 * consumer is a model that will act on what it reads.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeInline(text) {
  return String(text ?? "")
    .replace(/[\\`*_[\]()<>#|]/g, match => `\\${match}`)
    .replace(/\r?\n/g, " ")
    .trim();
}
