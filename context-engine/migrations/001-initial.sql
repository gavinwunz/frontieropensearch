-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at http://mozilla.org/MPL/2.0/.
--
-- Context Engine, schema version 1. See context-engine/SCHEMA.md.
--
-- A migration is never edited once it has shipped. Correct it with a new one.
--
-- Statements are separated by a line containing only `--@`. The runner splits
-- on that marker rather than on semicolons, because a semicolon is legal
-- inside a trigger body or a string literal and a naive split would corrupt
-- one silently.

CREATE TABLE trail (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
)
--@
-- The spine. `parent_id` is the node navigated from; going back is a cursor
-- move and never deletes a child, so a forward branch survives as a sibling.
-- `dismissed_at` is soft: a dismissed node has left the Field and is still on
-- its trail and still restorable.
CREATE TABLE trail_node (
  id              INTEGER PRIMARY KEY,
  trail_id        INTEGER NOT NULL REFERENCES trail(id),
  parent_id       INTEGER REFERENCES trail_node(id),
  url             TEXT NOT NULL,
  title           TEXT,
  scroll_x        INTEGER,
  scroll_y        INTEGER,
  form_state      BLOB,
  created_at      INTEGER NOT NULL,
  last_visited_at INTEGER,
  dismissed_at    INTEGER
)
--@
CREATE INDEX trail_node_trail_parent ON trail_node(trail_id, parent_id)
--@
-- `trail_node` is a visit, not a document, so one URL is already many rows
-- across many trails. This index is what makes a trail crossing — "you have
-- reached this page from three different trails" — a lookup rather than a scan.
CREATE INDEX trail_node_url ON trail_node(url)
--@
CREATE TABLE query (
  id             INTEGER PRIMARY KEY,
  trail_node_id  INTEGER REFERENCES trail_node(id),
  source_node_id INTEGER REFERENCES trail_node(id),
  raw            TEXT NOT NULL,
  normalised_intent TEXT,
  input_mode     TEXT NOT NULL CHECK (input_mode IN ('keyboard', 'voice')),
  created_at     INTEGER NOT NULL
)
--@
CREATE INDEX query_node ON query(trail_node_id)
--@
-- `outcome` is derived, never asked for. It is what makes ranking by context
-- better than ranking by frecency: a page that was read counts for far more
-- than one that was bounced off.
CREATE TABLE visit (
  id            INTEGER PRIMARY KEY,
  trail_node_id INTEGER NOT NULL REFERENCES trail_node(id),
  started_at    INTEGER NOT NULL,
  dwell_ms      INTEGER,
  outcome       TEXT CHECK (outcome IN ('bounced', 'read', 'saved'))
)
--@
CREATE INDEX visit_node ON visit(trail_node_id)
--@
CREATE TABLE entity (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  canonical TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL CHECK (kind IN ('person', 'org', 'place', 'work', 'term'))
)
--@
-- Exactly one of `trail_node_id` or `query_id` is non-null.
CREATE TABLE entity_mention (
  id            INTEGER PRIMARY KEY,
  entity_id     INTEGER NOT NULL REFERENCES entity(id),
  trail_node_id INTEGER REFERENCES trail_node(id),
  query_id      INTEGER REFERENCES query(id),
  weight        REAL NOT NULL DEFAULT 1.0,
  CHECK ((trail_node_id IS NULL) <> (query_id IS NULL))
)
--@
CREATE INDEX entity_mention_entity ON entity_mention(entity_id)
--@
CREATE INDEX entity_mention_node ON entity_mention(trail_node_id)
--@
CREATE TABLE context (
  id         INTEGER PRIMARY KEY,
  label      TEXT,
  centroid   BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active_at  INTEGER
)
--@
-- `source` records *why* something is in a context, which is what lets a bad
-- clustering decision be explained and corrected rather than merely reversed.
--
-- The primary key carries a null column by design: a member is either a node or
-- a query. SQLite does not treat nulls as equal in a PRIMARY KEY, so the two
-- partial unique indexes below are what actually enforce uniqueness.
CREATE TABLE context_member (
  context_id    INTEGER NOT NULL REFERENCES context(id),
  trail_node_id INTEGER REFERENCES trail_node(id),
  query_id      INTEGER REFERENCES query(id),
  weight        REAL NOT NULL DEFAULT 1.0,
  source        TEXT NOT NULL CHECK (source IN ('embedding', 'provenance', 'spatial', 'manual')),
  CHECK ((trail_node_id IS NULL) <> (query_id IS NULL))
)
--@
CREATE UNIQUE INDEX context_member_node
  ON context_member(context_id, trail_node_id) WHERE trail_node_id IS NOT NULL
--@
CREATE UNIQUE INDEX context_member_query
  ON context_member(context_id, query_id) WHERE query_id IS NOT NULL
--@
-- Vectors live apart from the records they describe so that a model change can
-- invalidate and recompute them without touching a single row of evidence.
CREATE TABLE embedding (
  id         INTEGER PRIMARY KEY,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN ('trail_node', 'query', 'context')),
  ref_id     INTEGER NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at INTEGER NOT NULL
)
--@
CREATE UNIQUE INDEX embedding_ref ON embedding(ref_kind, ref_id, model)
--@
-- Where the user put a card is evidence about what they think, and it is
-- evidence they never had to articulate. `moved_by_user_at` is the whole point
-- of the table: an auto-placed card says nothing, a moved one says a great deal.
CREATE TABLE field_placement (
  trail_node_id    INTEGER PRIMARY KEY REFERENCES trail_node(id),
  x                REAL NOT NULL,
  y                REAL NOT NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  moved_by_user_at INTEGER
)
