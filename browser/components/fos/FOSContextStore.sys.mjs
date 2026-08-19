/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Context Engine's durable store.
 *
 * A local SQLite database in the profile directory, and the only thing in this
 * component that touches a disk. It is local and it stays local: there is no
 * sync, no account, no upload, and no network access anywhere in this file or
 * anything it calls. See `context-engine/SCHEMA.md`.
 *
 * Everything here is async, because `Sqlite.sys.mjs` is. Callers on the
 * navigation path must therefore not await it — recording is a side effect of
 * browsing and must never be able to hold a page load up. `FOSContextEngine`
 * is where that discipline lives.
 *
 * IDS. The in-memory `TrailStore` numbers its own trails and nodes from 1 for
 * each session, so those ids collide across restarts and cannot be database
 * keys. The database allocates its own, and the recorder holds the mapping for
 * the life of the session. The consequence worth knowing is that the store is
 * currently write-mostly: it is the durable record of what happened, but the
 * in-memory tree is not yet rehydrated from it at startup, so a restart still
 * begins with an empty Field and an empty rail. Rehydration is the next piece
 * of work on this file and is deliberately not smuggled in here.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Sqlite: "resource://gre/modules/Sqlite.sys.mjs",
});

/** The database file, in the profile directory. */
export const DATABASE_FILENAME = "context-engine.sqlite";

/**
 * Migrations in order, as `[version, url]`.
 *
 * They are real `.sql` files rather than strings in this module, and are
 * packaged into the browser jar so they can be read at runtime. That is worth
 * the packaging step: `SCHEMA.md` says a migration is never edited once it has
 * shipped, and a numbered file that only ever gets added to is far easier to
 * audit for that than a growing array of template literals. It also means the
 * schema can be read, diffed and applied by hand with `sqlite3` when something
 * has gone wrong, which is exactly when you do not want to be extracting SQL
 * from JavaScript.
 */
const MIGRATIONS = [
  [1, "chrome://browser/content/fos/migrations/001-initial.sql"],
  [2, "chrome://browser/content/fos/migrations/002-merged-contexts.sql"],
];

/** The schema version this build expects. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1][0];

/**
 * Statement separator inside a migration file.
 *
 * Splitting on `;` is the obvious thing and is wrong: a semicolon is legal
 * inside a trigger body and inside a string literal, so a naive split silently
 * cuts a statement in half and the corruption shows up as a syntax error in
 * something that looks correct. An explicit marker on its own line cannot be
 * produced by accident.
 */
const STATEMENT_SEPARATOR = /^--@$/m;

/**
 *
 */
export class FOSContextStore {
  #connection;
  #restorationClaimed = false;

  /**
   * Prefer `open()`. This takes an already-open connection so that a test can
   * supply one and so that `open()` can close it again if a migration throws.
   *
   * @param {object} connection An open `Sqlite` connection.
   */
  constructor(connection) {
    this.#connection = connection;
  }

  /** The underlying connection, for tests and for one-off queries. */
  get connection() {
    return this.#connection;
  }

  /**
   * Open the store, applying any outstanding migrations.
   *
   * @param {object} [options]
   * @param {string} [options.path] Database path; defaults to the profile.
   * @returns {Promise<FOSContextStore>}
   */
  static async open({ path } = {}) {
    const target =
      path ?? PathUtils.join(PathUtils.profileDir, DATABASE_FILENAME);
    const connection = await lazy.Sqlite.openConnection({
      path: target,
      // The tables are small and the writes are on the navigation path, so
      // durability matters more than throughput; the defaults are right.
    });
    const store = new FOSContextStore(connection);
    try {
      await store.#migrate();
    } catch (e) {
      await connection.close();
      throw e;
    }
    return store;
  }

  /**
   * Bring the database up to `SCHEMA_VERSION`.
   *
   * Forward-only, one transaction per migration, so a failure part-way leaves
   * the database at the last version that fully applied rather than at a half
   * of the next one.
   */
  async #migrate() {
    let version = await this.#connection.getSchemaVersion();
    for (const [target, url] of MIGRATIONS) {
      if (version >= target) {
        continue;
      }
      const sql = await fetchText(url);
      const statements = sql
        .split(STATEMENT_SEPARATOR)
        .map(part => part.trim())
        .filter(Boolean);
      await this.#connection.executeTransaction(async () => {
        for (const statement of statements) {
          await this.#connection.execute(statement);
        }
      });
      // Set outside the transaction: `PRAGMA user_version` is not transactional
      // in SQLite, so writing it inside one would leave the version set even if
      // the transaction rolled back.
      await this.#connection.setSchemaVersion(target);
      version = target;
    }
    return version;
  }

  /** Close the connection. Idempotent from the caller's point of view. */
  async close() {
    await this.#connection.close();
  }

  // ---- trails and nodes ---------------------------------------------------

  /**
   * Create a trail row.
   *
   * @param {object} [fields]
   * @param {?string} [fields.name]
   * @param {number} [fields.now] Unix ms.
   * @returns {Promise<number>} The trail's database id.
   */
  async addTrail({ name = null, now = Date.now() } = {}) {
    return this.#insert(
      `INSERT INTO trail (name, created_at, updated_at)
       VALUES (:name, :now, :now)`,
      { name, now }
    );
  }

  /**
   * @param {number} trailId
   * @param {string} name
   */
  async nameTrail(trailId, name) {
    await this.#connection.execute(
      `UPDATE trail SET name = :name, updated_at = :now WHERE id = :id`,
      { id: trailId, name, now: Date.now() }
    );
  }

  /**
   * `done`: mark a trail finished, so `restorable()` stops offering it.
   *
   * `updated_at` is deliberately left alone. It records when the trail last
   * changed as a thread of work, and finishing it is a statement *about* that
   * work rather than more of it — moving the timestamp would make every
   * archived trail look freshly worked on to anything that reads recency,
   * which is the one thing archiving exists to correct.
   *
   * @param {number} trailId
   * @param {number} [now] Unix ms.
   */
  async archiveTrail(trailId, now = Date.now()) {
    await this.#connection.execute(
      `UPDATE trail SET archived_at = :now
       WHERE id = :id AND archived_at IS NULL`,
      { id: trailId, now }
    );
  }

  /**
   * Record a page as a node on a trail.
   *
   * @param {object} fields
   * @param {number} fields.trailId
   * @param {?number} [fields.parentId] Null at a trail root.
   * @param {string} fields.url
   * @param {?string} [fields.title]
   * @param {number} [fields.now] Unix ms.
   * @returns {Promise<number>} The node's database id.
   */
  async addNode({
    trailId,
    parentId = null,
    url,
    title = null,
    now = Date.now(),
  }) {
    return this.#insert(
      `INSERT INTO trail_node (trail_id, parent_id, url, title, created_at,
                               last_visited_at)
       VALUES (:trailId, :parentId, :url, :title, :now, :now)`,
      { trailId, parentId, url, title, now }
    );
  }

  /**
   * Update what is known about a node. Only the fields passed are written.
   *
   * The scroll offset and form state are the fallback copy, not the truth:
   * `SCHEMA.md` makes the live `nsISHEntry` authoritative whenever the node
   * still has one, and these columns are for after a restart, when it does not.
   *
   * @param {number} nodeId
   * @param {object} fields
   */
  async updateNode(nodeId, fields = {}) {
    const columns = {
      title: "title",
      scrollX: "scroll_x",
      scrollY: "scroll_y",
      formState: "form_state",
      lastVisitedAt: "last_visited_at",
      dismissedAt: "dismissed_at",
    };
    const sets = [];
    const params = { id: nodeId };
    for (const [key, column] of Object.entries(columns)) {
      if (fields[key] !== undefined) {
        sets.push(`${column} = :${key}`);
        params[key] = fields[key];
      }
    }
    if (!sets.length) {
      return;
    }
    await this.#connection.execute(
      `UPDATE trail_node SET ${sets.join(", ")} WHERE id = :id`,
      params
    );
  }

  /**
   * Mark a node as no longer on the Field. It stays on its trail.
   *
   * @param {number} nodeId
   * @param {number} [now] Unix ms.
   */
  async dismissNode(nodeId, now = Date.now()) {
    await this.updateNode(nodeId, { dismissedAt: now });
  }

  /**
   * Every page on one trail, most recently visited first.
   *
   * The command bar's third tier. It reads the trail from the database rather
   * than from the window's tree, which looks redundant — the active trail is
   * in memory by definition — and is not: close to 60% of complex
   * information-gathering tasks continue across sessions, so the trail the
   * user is on is very often a trail that was *restored*, and one read path
   * for every tier is what stops a restored trail and a live one being ranked
   * by different rules.
   *
   * @param {number} trailId A database trail id.
   * @param {object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<object[]>} `{id, url, title, last_visited_at}`.
   */
  async trailPages(trailId, { limit = 200 } = {}) {
    const rows = await this.#connection.execute(
      `SELECT id, url, title, created_at, last_visited_at
       FROM trail_node
       WHERE trail_id = :trailId
       ORDER BY COALESCE(last_visited_at, created_at) DESC
       LIMIT :limit`,
      { trailId, limit }
    );
    return rows.map(row =>
      plain(row, ["id", "url", "title", "created_at", "last_visited_at"])
    );
  }

  /**
   * Pages another trail reached, on a trail that also reached this context.
   *
   * The command bar's fourth tier, and the one tier no other browser could
   * offer. A context holds a set of pages; some of those pages were also
   * visited on trails belonging to other lines of enquiry; and the *rest* of
   * what those trails found is material this context has never seen but which
   * demonstrably neighbours it. That is Bush's associative trail used as a
   * retrieval signal rather than as a picture — the connection was made by
   * someone browsing, which here is always the same person, and never by a
   * similarity threshold.
   *
   * Pages already in the context are excluded, since tier 2 has them, and so
   * is the trail the user is on, since tier 3 has that.
   *
   * @param {number} contextId
   * @param {object} [options]
   * @param {?number} [options.excludeTrailId] Usually the active trail.
   * @param {number} [options.limit]
   * @returns {Promise<object[]>} `{id, url, title, trail_id, trail_name}`.
   */
  async contextCrossings(
    contextId,
    { excludeTrailId = null, limit = 200 } = {}
  ) {
    const rows = await this.#connection.execute(
      `WITH shared AS (
         SELECT DISTINCT other.trail_id AS trail_id
         FROM context_member m
         JOIN trail_node mine ON mine.id = m.trail_node_id
         JOIN trail_node other ON other.url = mine.url
         WHERE m.context_id = :contextId
           AND (:excludeTrailId IS NULL OR other.trail_id <> :excludeTrailId)
       )
       SELECT n.id, n.url, n.title, n.trail_id, t.name AS trail_name,
              COALESCE(n.last_visited_at, n.created_at) AS seen_at
       FROM trail_node n
       JOIN shared s ON s.trail_id = n.trail_id
       JOIN trail t ON t.id = n.trail_id
       WHERE n.id NOT IN (
               SELECT trail_node_id FROM context_member
               WHERE context_id = :contextId AND trail_node_id IS NOT NULL)
       ORDER BY seen_at DESC
       LIMIT :limit`,
      { contextId, excludeTrailId, limit }
    );
    return rows.map(row =>
      plain(row, ["id", "url", "title", "trail_id", "trail_name", "seen_at"])
    );
  }

  /**
   * Every node in the database for a URL, whatever trail it is on.
   *
   * This is the memex's compounding effect made queryable. `trail_node` is a
   * visit rather than a document, so one URL is already many rows across many
   * trails and no schema change was needed to express it — arriving at a page
   * from one line of enquiry can expose the others.
   *
   * @param {string} url
   * @returns {Promise<object[]>} `{node_id, trail_id, trail_name, created_at}`.
   */
  async crossings(url) {
    const rows = await this.#connection.execute(
      `SELECT n.id AS node_id, n.trail_id, t.name AS trail_name, n.created_at
       FROM trail_node n JOIN trail t ON t.id = n.trail_id
       WHERE n.url = :url
       ORDER BY n.created_at`,
      { url }
    );
    return rows.map(row =>
      plain(row, ["node_id", "trail_id", "trail_name", "created_at"])
    );
  }

  // ---- restoration --------------------------------------------------------

  /**
   * Claim the right to restore from this database. True once, then false.
   *
   * The claim lives here rather than in the window that makes it because one
   * database is what "the previous session" means: every window shares this
   * store, so the first to ask is the one that gets the past back and the
   * others open as they always did. Two windows each holding their own copy of
   * one trail would put it on two Fields and have both reconcile onto the same
   * rows.
   *
   * @returns {boolean} Whether the caller may restore.
   */
  claimRestoration() {
    if (this.#restorationClaimed) {
      return false;
    }
    this.#restorationClaimed = true;
    return true;
  }

  /**
   * The trails a new session should open with, and all of their nodes.
   *
   * **What comes back is bounded by rank, not by a clock.** The K most
   * recently updated trails return, whether that is yesterday's work or last
   * month's; nothing is deleted and nothing else is inferred. A time window
   * was the alternative and it decides the same question worse: it makes a
   * fortnight away from the machine indistinguishable from having finished,
   * and this project has already found that a clock is a poor judge of what a
   * user is still working on.
   *
   * **A trail comes back whole or not at all.** The node budget drops whole
   * trails from the tail of the ordering rather than truncating one, because a
   * trail missing its middle would render as a tree that was never browsed.
   *
   * Named trails are not privileged here, which is a real limit and is
   * deliberate for now: naming a trail touches `updated_at`, so a named trail
   * is recent by construction on the day it is named and ages out like
   * anything else afterwards. Pinning names past that wants a surface for
   * finding old trails first — restoring them into the Field forever is how a
   * bookmark graveyard is built.
   *
   * @param {object} [options]
   * @param {number} [options.trailLimit] How many trails at most.
   * @param {number} [options.nodeLimit] How many nodes at most, in total.
   * @returns {Promise<{trails: object[], nodes: object[]}>}
   */
  async restorable({ trailLimit = 12, nodeLimit = 4000 } = {}) {
    const candidates = await this.#connection.execute(
      `SELECT t.id, t.name, t.created_at, t.updated_at, t.archived_at,
              (SELECT COUNT(*) FROM trail_node n WHERE n.trail_id = t.id)
                AS node_count
       FROM trail t
       WHERE t.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM trail_node n WHERE n.trail_id = t.id)
       ORDER BY t.updated_at DESC, t.id DESC
       LIMIT :trailLimit`,
      { trailLimit }
    );

    const trails = [];
    let budget = nodeLimit;
    for (const row of candidates) {
      const trail = plain(row, [
        "id",
        "name",
        "created_at",
        "updated_at",
        "archived_at",
        "node_count",
      ]);
      if (trail.node_count > budget) {
        continue;
      }
      budget -= trail.node_count;
      delete trail.node_count;
      trails.push(trail);
    }

    return { trails, nodes: await this.nodesForTrails(trails.map(t => t.id)) };
  }

  /**
   * Every node of the given trails, dismissed ones included.
   *
   * A dismissed node has left the Field and is still on its trail, so leaving
   * it behind here would quietly turn dismissal into deletion at the next
   * restart.
   *
   * @param {number[]} trailIds
   * @returns {Promise<object[]>} `trail_node` rows.
   */
  async nodesForTrails(trailIds) {
    if (!trailIds.length) {
      return [];
    }
    const { names, params } = bindList(trailIds, "t");
    const rows = await this.#connection.execute(
      `SELECT id, trail_id, parent_id, url, title, scroll_x, scroll_y,
              form_state, created_at, last_visited_at, dismissed_at
       FROM trail_node WHERE trail_id IN (${names}) ORDER BY id`,
      params
    );
    return rows.map(row =>
      plain(row, [
        "id",
        "trail_id",
        "parent_id",
        "url",
        "title",
        "scroll_x",
        "scroll_y",
        "form_state",
        "created_at",
        "last_visited_at",
        "dismissed_at",
      ])
    );
  }

  /**
   * Each trail's provenance context, so a restored trail keeps its topic.
   *
   * Nothing links a trail to a context directly — membership is per node, by
   * design, because a context is a set of records and not a second name for a
   * trail. The link is therefore read back rather than stored: the context
   * most of a trail's nodes joined by provenance is that trail's context. A
   * majority rather than a first row, because `context <mark>` can move
   * individual records and the answer must survive that.
   *
   * @param {number[]} trailIds
   * @returns {Promise<Map<number, number>>} Trail id → context id.
   */
  async contextsForTrails(trailIds) {
    const byTrail = new Map();
    if (!trailIds.length) {
      return byTrail;
    }
    const { names, params } = bindList(trailIds, "t");
    const rows = await this.#connection.execute(
      `SELECT n.trail_id, m.context_id, COUNT(*) AS members
       FROM context_member m
       JOIN trail_node n ON n.id = m.trail_node_id
       WHERE m.source = 'provenance' AND n.trail_id IN (${names})
       GROUP BY n.trail_id, m.context_id
       ORDER BY members DESC`,
      params
    );
    // Resolved through any accepted merge, which is what makes a merge change
    // *which context is active* rather than only what one contains. The
    // provenance rows above are untouched by a merge on purpose, so this is
    // the only place the two statements are combined.
    const roots = await this.mergeRoots();
    for (const row of rows) {
      const { trail_id: trailId, context_id: contextId } = plain(row, [
        "trail_id",
        "context_id",
      ]);
      if (!byTrail.has(trailId)) {
        byTrail.set(trailId, roots.get(contextId) ?? contextId);
      }
    }
    return byTrail;
  }

  // ---- queries, visits, entities ------------------------------------------

  /**
   * @param {object} fields
   * @param {string} fields.raw Exactly what was typed or spoken.
   * @param {?string} [fields.normalisedIntent]
   * @param {?number} [fields.trailNodeId] The node the query spawned.
   * @param {?number} [fields.sourceNodeId] Where it was issued from.
   * @param {string} [fields.inputMode] `keyboard` | `voice`.
   * @param {number} [fields.now] Unix ms.
   * @returns {Promise<number>} The query's database id.
   */
  async recordQuery({
    raw,
    normalisedIntent = null,
    trailNodeId = null,
    sourceNodeId = null,
    inputMode = "keyboard",
    now = Date.now(),
  }) {
    return this.#insert(
      `INSERT INTO query (trail_node_id, source_node_id, raw, normalised_intent,
                          input_mode, created_at)
       VALUES (:trailNodeId, :sourceNodeId, :raw, :normalisedIntent,
               :inputMode, :now)`,
      { trailNodeId, sourceNodeId, raw, normalisedIntent, inputMode, now }
    );
  }

  /**
   * Attach a query to the node it eventually landed on.
   *
   * The query is recorded when it is issued, which is before the page it opens
   * has a node, so this closes the loop once the navigation has arrived.
   *
   * @param {number} queryId
   * @param {number} nodeId
   */
  async attachQueryToNode(queryId, nodeId) {
    await this.#connection.execute(
      `UPDATE query SET trail_node_id = :nodeId WHERE id = :id`,
      { id: queryId, nodeId }
    );
  }

  /**
   * Open a visit. Close it with `endVisit`.
   *
   * @param {number} nodeId
   * @param {number} [startedAt] Unix ms.
   * @returns {Promise<number>} The visit's database id.
   */
  async startVisit(nodeId, startedAt = Date.now()) {
    return this.#insert(
      `INSERT INTO visit (trail_node_id, started_at) VALUES (:nodeId, :startedAt)`,
      { nodeId, startedAt }
    );
  }

  /**
   * @param {number} visitId
   * @param {object} fields
   * @param {number} fields.dwellMs Foreground time only.
   * @param {string} fields.outcome `bounced` | `read` | `saved`.
   */
  async endVisit(visitId, { dwellMs, outcome }) {
    await this.#connection.execute(
      `UPDATE visit SET dwell_ms = :dwellMs, outcome = :outcome WHERE id = :id`,
      { id: visitId, dwellMs: Math.round(dwellMs), outcome }
    );
  }

  /**
   * Record entity mentions against a node or a query.
   *
   * @param {object[]} entities From `extractEntities`.
   * @param {object} on Exactly one of `{nodeId}` or `{queryId}`.
   * @param {?number} [on.nodeId] The node the entities were found on.
   * @param {?number} [on.queryId] The query they were found in.
   * @returns {Promise<number>} How many mentions were written.
   */
  async recordEntities(entities, { nodeId = null, queryId = null } = {}) {
    if ((nodeId === null) === (queryId === null)) {
      throw new Error("recordEntities: pass exactly one of nodeId or queryId");
    }
    let written = 0;
    for (const entity of entities) {
      // `entity` is deduplicated by `canonical` across the whole database, so
      // the same term found on a query and on a page is one row with two
      // mentions — which is what makes a mention count mean anything.
      await this.#connection.execute(
        `INSERT INTO entity (name, canonical, kind) VALUES (:name, :canonical, :kind)
         ON CONFLICT(canonical) DO NOTHING`,
        { name: entity.name, canonical: entity.canonical, kind: entity.kind }
      );
      const [row] = await this.#connection.execute(
        `SELECT id FROM entity WHERE canonical = :canonical`,
        { canonical: entity.canonical }
      );
      await this.#connection.execute(
        `INSERT INTO entity_mention (entity_id, trail_node_id, query_id, weight)
         VALUES (:entityId, :nodeId, :queryId, :weight)`,
        {
          entityId: row.getResultByName("id"),
          nodeId,
          queryId,
          weight: entity.weight,
        }
      );
      written++;
    }
    return written;
  }

  // ---- contexts -----------------------------------------------------------

  /**
   * @param {object} [fields]
   * @param {?string} [fields.label]
   * @param {number} [fields.now] Unix ms.
   * @returns {Promise<number>} The context's database id.
   */
  async addContext({ label = null, now = Date.now() } = {}) {
    return this.#insert(
      `INSERT INTO context (label, created_at, updated_at, active_at)
       VALUES (:label, :now, :now, :now)`,
      { label, now }
    );
  }

  /**
   * @param {number} contextId
   * @param {string} label
   */
  async labelContext(contextId, label) {
    await this.#connection.execute(
      `UPDATE context SET label = :label, updated_at = :now WHERE id = :id`,
      { id: contextId, label, now: Date.now() }
    );
  }

  /**
   * Mark a context as the one being worked in.
   *
   * @param {number} contextId
   * @param {number} [now] Unix ms.
   */
  async touchContext(contextId, now = Date.now()) {
    await this.#connection.execute(
      `UPDATE context SET active_at = :now WHERE id = :id`,
      { id: contextId, now }
    );
  }

  /**
   * Put a node or a query in a context, recording why.
   *
   * `source` is the column that lets a bad clustering decision be explained
   * rather than merely reversed, so it is required and has no default.
   *
   * @param {number} contextId
   * @param {object} member Exactly one of `{nodeId}` or `{queryId}`.
   * @param {?number} [member.nodeId] A node to put in the context.
   * @param {?number} [member.queryId] A query to put in the context.
   * @param {number} [member.weight] Strength of the membership.
   * @param {string} member.source `embedding` | `provenance` | `spatial` | `manual`.
   */
  async addMember(
    contextId,
    { nodeId = null, queryId = null, weight = 1, source }
  ) {
    if ((nodeId === null) === (queryId === null)) {
      throw new Error("addMember: pass exactly one of nodeId or queryId");
    }
    await this.#connection.execute(
      `INSERT INTO context_member (context_id, trail_node_id, query_id, weight, source)
       VALUES (:contextId, :nodeId, :queryId, :weight, :source)
       ON CONFLICT DO NOTHING`,
      { contextId, nodeId, queryId, weight, source }
    );
  }

  // ---- merged contexts ----------------------------------------------------

  /**
   * Every merged context, mapped to the context it was merged into.
   *
   * One row per merge the user has ever accepted, which is a handful at most,
   * and the partial index means the read costs nothing on a profile that has
   * accepted none.
   *
   * @returns {Promise<Map<number, number>>} Merged id → root id.
   */
  async mergeRoots() {
    const rows = await this.#connection.execute(
      `SELECT id, merged_into FROM context WHERE merged_into IS NOT NULL`
    );
    const roots = new Map();
    for (const row of rows) {
      const { id, merged_into: root } = plain(row, ["id", "merged_into"]);
      roots.set(id, root);
    }
    return roots;
  }

  /**
   * The contexts that make up one context: its root and everything merged in.
   *
   * Always returns the root first, and always contains at least `contextId`
   * itself, so a caller can use it without asking whether anything was merged.
   *
   * @param {number} contextId Either a root or a merged context.
   * @returns {Promise<number[]>}
   */
  async contextFamily(contextId) {
    const roots = await this.mergeRoots();
    const root = roots.get(contextId) ?? contextId;
    const family = [root];
    for (const [merged, into] of roots) {
      if (into === root && merged !== root) {
        family.push(merged);
      }
    }
    return family;
  }

  /**
   * Record that two contexts are one enquiry, because the user said so.
   *
   * The surviving context is the one with the earlier id — the enquiry that
   * started first — rather than whichever one happened to be active when the
   * offer was accepted. An offer is symmetric ("these two are the same"), so
   * letting the active side win would make the outcome depend on which trail
   * the user was standing on, and the same pair accepted from the other side
   * would produce a different database.
   *
   * The invariant `merged_into` never names a merged context is kept here:
   * both sides are resolved to their roots first, so merging into something
   * already merged follows the chain instead of extending it. Everything that
   * had pointed at the losing root is re-pointed, which is what keeps
   * resolution one hop everywhere else.
   *
   * @param {number} a
   * @param {number} b
   * @returns {Promise<?{root: number, merged: number}>} Null if already one.
   */
  async mergeContexts(a, b) {
    const roots = await this.mergeRoots();
    const left = roots.get(a) ?? a;
    const right = roots.get(b) ?? b;
    if (left === right) {
      return null;
    }
    const root = Math.min(left, right);
    const merged = Math.max(left, right);
    const now = Date.now();

    await this.#connection.executeTransaction(async () => {
      await this.#connection.execute(
        `UPDATE context SET merged_into = :root, updated_at = :now
         WHERE id = :merged OR merged_into = :merged`,
        { root, merged, now }
      );
      await this.#connection.execute(
        `UPDATE context SET updated_at = :now WHERE id = :root`,
        { root, now }
      );
    });
    return { root, merged };
  }

  /**
   * Record that the user turned down an offer to merge two contexts.
   *
   * Stored so the offer is never made again. An offer that comes back after
   * being declined is worse than one never made: the second showing is proof
   * the first was not listened to, and it teaches the user to stop reading the
   * surface it appears on.
   *
   * @param {number} a
   * @param {number} b
   */
  async declineMerge(a, b) {
    await this.#connection.execute(
      `INSERT INTO context_merge_declined (low_id, high_id, declined_at)
       VALUES (:low, :high, :now) ON CONFLICT DO NOTHING`,
      { low: Math.min(a, b), high: Math.max(a, b), now: Date.now() }
    );
  }

  /**
   * Every declined pair, as `"low:high"` keys.
   *
   * @returns {Promise<Set<string>>}
   */
  async declinedMerges() {
    const rows = await this.#connection.execute(
      `SELECT low_id, high_id FROM context_merge_declined`
    );
    return new Set(
      rows.map(row => {
        const { low_id: low, high_id: high } = plain(row, [
          "low_id",
          "high_id",
        ]);
        return `${low}:${high}`;
      })
    );
  }

  /**
   * The queries belonging to each of several contexts, for scoring them.
   *
   * Raw text rather than `normalised_intent`, because the model this feeds is
   * a static embedding table whose rows are words as written — normalising is
   * the lexical path's preparation and throws away what this one reads.
   *
   * @param {number[]} contextIds
   * @param {number} [perContext] Most recent N per context.
   * @returns {Promise<Map<number, string[]>>}
   */
  async contextQueryTexts(contextIds, perContext = 12) {
    const byContext = new Map();
    if (!contextIds.length) {
      return byContext;
    }
    const { names, params } = bindList(contextIds, "c");
    const rows = await this.#connection.execute(
      `SELECT m.context_id, q.raw, q.created_at
       FROM query q JOIN context_member m ON m.query_id = q.id
       WHERE m.context_id IN (${names})
       ORDER BY m.context_id, q.created_at DESC`,
      params
    );
    for (const row of rows) {
      const { context_id: contextId, raw } = plain(row, ["context_id", "raw"]);
      const texts = byContext.get(contextId) ?? [];
      if (texts.length < perContext) {
        texts.push(raw);
        byContext.set(contextId, texts);
      }
    }
    return byContext;
  }

  /** @returns {Promise<?object>} The most recently active context, or null. */
  async activeContext() {
    const [row] = await this.#connection.execute(
      `SELECT id, label, created_at, active_at FROM context
       ORDER BY active_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    return row ? plain(row, ["id", "label", "created_at", "active_at"]) : null;
  }

  /**
   * Every context, most recently active first.
   *
   * A merged context is not one of them. It still exists, and every row that
   * ever pointed at it still does, but it is no longer somewhere the user can
   * switch to — `context <mark>` offering both halves of an enquiry they just
   * told the browser was one enquiry would be the browser arguing back. Its
   * members and its last-active time count towards the context it merged into,
   * so nothing is lost from the list, only from the count of rows in it.
   *
   * @returns {Promise<object[]>}
   */
  async contexts() {
    const rows = await this.#connection.execute(
      `SELECT c.id, c.label,
              MAX(c.active_at, IFNULL((SELECT MAX(m.active_at) FROM context m
                                       WHERE m.merged_into = c.id), 0)) AS active_at,
              (SELECT COUNT(*) FROM context_member m
               WHERE m.context_id = c.id OR m.context_id IN (
                 SELECT id FROM context WHERE merged_into = c.id)) AS members
       FROM context c WHERE c.merged_into IS NULL
       ORDER BY active_at DESC NULLS LAST, c.id DESC`
    );
    return rows.map(row => plain(row, ["id", "label", "active_at", "members"]));
  }

  /**
   * Everything the engine holds on one context, as plain rows.
   *
   * This is the single read behind both `what` and `pack`, so that the summary
   * the user is shown and the brief they export can never disagree.
   *
   * @param {number} contextId
   * @returns {Promise<object>} `{context, queries, pages, entities}`.
   */
  async contextContents(contextId) {
    // Asked about either half of a merged pair, this answers about the whole.
    // `what` and `pack` both come through here, so a merge the user accepted
    // shows up in the summary and in the exported brief without either surface
    // knowing that merges exist.
    const family = await this.contextFamily(contextId);
    const { names, params } = bindList(family, "f");

    const [contextRow] = await this.#connection.execute(
      `SELECT id, label, created_at, active_at FROM context WHERE id = :root`,
      { root: family[0] }
    );
    if (!contextRow) {
      return null;
    }

    const queries = (
      await this.#connection.execute(
        `SELECT q.id, q.raw, q.normalised_intent, q.input_mode, q.created_at,
                q.trail_node_id
         FROM query q JOIN context_member m ON m.query_id = q.id
         WHERE m.context_id IN (${names}) ORDER BY q.created_at`,
        params
      )
    ).map(row =>
      plain(row, [
        "id",
        "raw",
        "normalised_intent",
        "input_mode",
        "created_at",
        "trail_node_id",
      ])
    );

    // A page's outcome is the best any visit to it achieved, not the last:
    // reading a page and later bouncing off it does not un-read it. `saved`
    // sorts above `read` above `bounced`, which is why the CASE is ordered.
    const pages = (
      await this.#connection.execute(
        `SELECT n.id, n.url, n.title, n.dismissed_at, n.trail_id,
                t.name AS trail_name,
                MAX(v.dwell_ms) AS dwell_ms,
                MAX(CASE v.outcome WHEN 'saved' THEN 3 WHEN 'read' THEN 2
                                   WHEN 'bounced' THEN 1 ELSE 0 END) AS rank
         FROM trail_node n
         JOIN context_member m ON m.trail_node_id = n.id
         JOIN trail t ON t.id = n.trail_id
         LEFT JOIN visit v ON v.trail_node_id = n.id
         WHERE m.context_id IN (${names})
         GROUP BY n.id ORDER BY rank DESC, n.created_at`,
        params
      )
    ).map(row => {
      const page = plain(row, [
        "id",
        "url",
        "title",
        "dismissed_at",
        "trail_id",
        "trail_name",
        "dwell_ms",
        "rank",
      ]);
      page.outcome =
        ["unvisited", "bounced", "read", "saved"][page.rank] ?? "unvisited";
      delete page.rank;
      return page;
    });

    // Entities reached through either kind of member, weighted by how often and
    // how saliently they were mentioned.
    const entities = (
      await this.#connection.execute(
        `SELECT e.name, e.canonical, e.kind,
                SUM(em.weight) AS weight, COUNT(*) AS mentions
         FROM entity e JOIN entity_mention em ON em.entity_id = e.id
         WHERE em.trail_node_id IN (
                 SELECT trail_node_id FROM context_member
                 WHERE context_id IN (${names}) AND trail_node_id IS NOT NULL)
            OR em.query_id IN (
                 SELECT query_id FROM context_member
                 WHERE context_id IN (${names}) AND query_id IS NOT NULL)
         GROUP BY e.id ORDER BY weight DESC, e.canonical`,
        params
      )
    ).map(row =>
      plain(row, ["name", "canonical", "kind", "weight", "mentions"])
    );

    return {
      context: plain(contextRow, ["id", "label", "created_at", "active_at"]),
      queries,
      pages,
      entities,
    };
  }

  // ---- the Field ----------------------------------------------------------

  /**
   * Record where a card sits, and whether a human put it there.
   *
   * @param {number} nodeId
   * @param {object} placement
   * @param {number} placement.x
   * @param {number} placement.y
   * @param {boolean} [placement.pinned]
   * @param {?number} [placement.movedByUserAt] Null when auto-placed.
   */
  async placeCard(nodeId, { x, y, pinned = false, movedByUserAt = null }) {
    await this.#connection.execute(
      `INSERT INTO field_placement (trail_node_id, x, y, pinned, moved_by_user_at)
       VALUES (:nodeId, :x, :y, :pinned, :movedByUserAt)
       ON CONFLICT(trail_node_id) DO UPDATE SET
         x = :x, y = :y, pinned = :pinned,
         -- A placement the user made is never overwritten by an automatic one:
         -- COALESCE keeps the first human timestamp, which is the whole reason
         -- the column exists.
         moved_by_user_at = COALESCE(:movedByUserAt, moved_by_user_at)`,
      { nodeId, x, y, pinned: pinned ? 1 : 0, movedByUserAt }
    );
  }

  // ---- plumbing -----------------------------------------------------------

  /**
   * Run an INSERT and return the new row's `id`.
   *
   * `RETURNING` rather than a following `SELECT last_insert_rowid()`, and this
   * is a correctness fix rather than a saved round trip. One store is shared by
   * every window in the process, each window's engine serialises only its *own*
   * writes, and `last_insert_rowid()` is a property of the connection across
   * every table on it. So two statements meant one window could insert a trail
   * and read back the rowid of another window's `visit` — a plausible integer,
   * from the wrong table, with no error anywhere.
   *
   * What that produced was a database that pointed at rows which did not exist:
   * nodes on a `trail_id` no trail had, `context_member` rows naming node ids
   * nothing had ever written. Nothing deletes rows here, so those references
   * were never going to resolve, and every read through them silently returned
   * less than it should — an exported pack missing pages it holds membership
   * rows for, which is how this was finally caught.
   *
   * Every table this inserts into declares `id INTEGER PRIMARY KEY`, so
   * `RETURNING id` is the same number the old pair meant to read, obtained
   * atomically. Keep it that way: a table without that column would need its
   * own clause rather than this one.
   *
   * @param {string} sql An INSERT, without a RETURNING clause.
   * @param {object} params
   * @returns {Promise<number>}
   */
  async #insert(sql, params) {
    const [row] = await this.#connection.execute(`${sql} RETURNING id`, params);
    return row.getResultByName("id");
  }
}

/**
 * A `mozIStorageRow` as an ordinary object.
 *
 * @param {object} row
 * @param {string[]} names Columns to read.
 * @returns {object}
 */
function plain(row, names) {
  const out = {};
  for (const name of names) {
    out[name] = row.getResultByName(name);
  }
  return out;
}

/**
 * Named bindings for an `IN` list.
 *
 * `execute` binds one value per name and has no array form, so a list has to
 * become names. Building them beats interpolating the numbers: the values here
 * are ours rather than a user's, but a query that interpolates is a query that
 * teaches the next one to.
 *
 * @param {Array} values
 * @param {string} prefix A short parameter-name prefix.
 * @returns {{names: string, params: object}} `":p0, :p1"` and its bindings.
 */
function bindList(values, prefix) {
  const params = {};
  const names = values.map((value, i) => {
    params[`${prefix}${i}`] = value;
    return `:${prefix}${i}`;
  });
  return { names: names.join(", "), params };
}

/**
 * @param {string} url A chrome URL.
 * @returns {Promise<string>}
 */
async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FOSContextStore: cannot read ${url}`);
  }
  return response.text();
}
