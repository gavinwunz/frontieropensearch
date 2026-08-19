# Context Engine — schema

The Context Engine is a local SQLite database. It records what was asked, what
answered it, and what happened next, and clusters that into research contexts.

It is local and stays local. There is no sync, no account, no upload, and no
network access anywhere in this component. Embeddings are computed on-device by
the in-tree ML runtime (`toolkit/components/ml`); no text ever leaves the
machine.

Database file: `context-engine.sqlite` in the profile directory.

## Design notes

Three things in this schema are load-bearing and easy to get wrong.

**Trail nodes are the spine.** Every query, visit, context membership and Field
card hangs off `trail_node`. Navigation is a tree: `parent_id` is the node you
came from, and going back never deletes a child. A "back" is a cursor move, not
a mutation, so the forward branch survives as a sibling.

**Dismissal must be lossless.** The recurring complaint about tabs is that a tab
is unfinished work, and closing it loses scroll position and in-page state
(`agent/IDEAS.md`). So `trail_node` stores `scroll_x`/`scroll_y` and
`form_state`, and dismissal sets `dismissed_at` rather than deleting the row.
A dismissed node is still in its trail and still restorable.

**Where the user puts a card is evidence.** Following VIKI's spatial parser,
manual placement in the Field is signal, not decoration: `field_placement`
records it and `context_member.source` can attribute membership to `spatial`
rather than `embedding`. A card the user dragged next to another is weak
evidence that they belong to the same context, and it is evidence the user
never had to articulate.

**The live session-history entry wins.** `scroll_x`/`scroll_y`/`form_state`
duplicate state that Gecko already keeps: `nsISHEntry` carries a
`layoutHistoryState` holding scroll position *and* form values, which is how
bfcache restores a page. Two sources of truth drift, so the rule is that the
live entry is authoritative whenever the node still has one, and these columns
are the fallback for when it does not — after a restart, or once the docshell
has been discarded. Write them on navigation away and on dismissal; read them
only when `nsISHEntry` cannot supply the state. A trail node therefore
references a session-history entry and caches its state, rather than being a
bare URL with scroll numbers bolted on.

## Growth and pruning

A history tree only grows. Nyxt's `history-tree` names this as its main
limitation — nodes are freed only when their owner disappears, so the structure
expands without bound (`agent/IDEAS.md`). Soft dismissal via `dismissed_at`
makes this *worse* here, because nothing is ever deleted by normal use. That is
the right default for a browser whose entire promise is not losing things, but
it needs a stated policy rather than silence:

- **Nothing is pruned automatically in Phase 2.** Correctness first. A tree of a
  few hundred thousand nodes is well within SQLite's comfort, and guessing at an
  eviction rule before there is real usage data is how you delete the one page
  the user wanted.
- **`form_state` is the size risk, not the row count.** Rows are tens of bytes;
  a session-store blob is not. Cap the stored blob, and drop it first when a
  node is archived — scroll position is small and worth keeping far longer.
- **Archival, when it comes, is by trail and not by node.** Pruning individual
  nodes tears holes in a tree and orphans children. A whole trail that has not
  been touched in months can be rolled into a compact archived form; a node in
  the middle of a live trail cannot.
- **Never prune a node a context still references.** `context_member` and
  `entity_mention` point at nodes; the Context Engine's value is the long tail,
  so a node cited by a saved context outlives any age rule.

## Migrations

Versioned and forward-only. `PRAGMA user_version` holds the applied version;
each migration is a numbered file under `context-engine/migrations/` named
`NNN-description.sql`, applied in order inside a single transaction. A migration
is never edited once it has shipped — correct it with a new one.

| Version | File | Change |
|---|---|---|
| 1 | `001-initial.sql` | Everything below. |

The files are packaged into the browser jar and read at runtime over
`chrome://browser/content/fos/migrations/`, so they stay `.sql` rather than
becoming string literals in a module: a shipped migration is immutable, and a
numbered file that is only ever added to is what makes that auditable — and
when something has gone wrong, the schema can be applied and diffed by hand
with `sqlite3` instead of being extracted from JavaScript.

Statements within a file are separated by a line containing only `--@`. A split
on `;` is the obvious thing and is wrong: a semicolon is legal inside a trigger
body and inside a string literal, so a naive split cuts a statement in half and
the corruption surfaces as a syntax error in something that looks correct.

`PRAGMA user_version` is set *outside* the transaction that applies a
migration, because it is not transactional in SQLite — written inside one it
would survive a rollback and leave the database claiming a version it does not
have.

## Tables

### `trail`

A named, saveable, exportable research thread.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | User-supplied; null until named. |
| `created_at` | INTEGER | Unix ms. |
| `updated_at` | INTEGER | Unix ms. |
| `archived_at` | INTEGER | Null when active; set by `done`. |

`archived_at` is written by the `done` verb and read by `restorable()`, which is
the whole of its meaning: **a finished trail is not offered back at the next
start.** Nothing else changes — the tree, the scroll offsets, the nodes and the
context all survive, and the pages stay findable through the command bar by
subject rather than by URL.

It is cleared again when the user re-enters any of the trail's nodes, which is
the only way back and the only undo `done` has. `updated_at` moves on the way
back but not on the way out: finishing work is a statement about it, resuming it
is working on it again.

It exists because recency cannot express it. A trail finished an hour ago and a
trail paused an hour ago have the same `updated_at`, so without a second column
the resumption list can be *ordered* but never *shortened*, and it is the only
list in this schema a person has to scan rather than query. `updated_at` is
therefore deliberately left alone when a trail is archived: finishing work is a
statement about it, not more of it.

### `trail_node`

One page in a trail. The tree, not a list.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `trail_id` | INTEGER FK → `trail.id` | |
| `parent_id` | INTEGER FK → `trail_node.id` | Null at a trail root. |
| `url` | TEXT | |
| `title` | TEXT | |
| `scroll_x` | INTEGER | Restored on re-entry. |
| `scroll_y` | INTEGER | Restored on re-entry. |
| `form_state` | BLOB | Gecko session-store blob; null if none. |
| `created_at` | INTEGER | When the node was spawned. |
| `last_visited_at` | INTEGER | |
| `dismissed_at` | INTEGER | Removed from the Field, still in the trail. |

Indexed on `(trail_id, parent_id)` and on `url`.

### `query`

A search or command-bar entry. `raw` is exactly what was typed or spoken;
`normalised_intent` is the cleaned-up form used for matching.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `trail_node_id` | INTEGER FK → `trail_node.id` | The node the query spawned. |
| `source_node_id` | INTEGER FK → `trail_node.id` | Where it was issued from. |
| `raw` | TEXT | |
| `normalised_intent` | TEXT | |
| `input_mode` | TEXT | `keyboard` \| `voice`. |
| `created_at` | INTEGER | |

### `visit`

What actually happened at a node. Outcome is the signal that makes ranking by
context better than ranking by frecency: a page that was read or saved counts
for far more than one that was bounced off.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `trail_node_id` | INTEGER FK → `trail_node.id` | |
| `started_at` | INTEGER | |
| `dwell_ms` | INTEGER | Foreground time only. |
| `outcome` | TEXT | `bounced` \| `read` \| `saved`. |

`outcome` is derived, not asked for: `bounced` under a dwell threshold, `read`
above it, `saved` on an explicit user act.

### `entity`

Entities extracted from queries and page text, deduplicated by `canonical`.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | As it appeared. |
| `canonical` | TEXT | Normalised key; unique. |
| `kind` | TEXT | `person` \| `org` \| `place` \| `work` \| `term`. |

### `entity_mention`

Join table. Exactly one of `trail_node_id` or `query_id` is non-null.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `entity_id` | INTEGER FK → `entity.id` | |
| `trail_node_id` | INTEGER FK → `trail_node.id` | |
| `query_id` | INTEGER FK → `query.id` | |
| `weight` | REAL | Mention salience. |

### `context`

A research topic: the cluster that queries and visits fall into.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `label` | TEXT | Generated, user-editable. |
| `centroid` | BLOB | Float32 vector, mean of member embeddings. Unwritten — see below. |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |
| `active_at` | INTEGER | Last time this context was the active one. |
| `merged_into` | INTEGER FK → `context.id` | Set when the user accepted a merge offer. |

`merged_into` is how "these two are one enquiry" is recorded, and it is a fact
about contexts rather than about membership. Writing the merged rows as
`context_member.source = 'manual'` was the plan and does not work:
`contextsForTrails` filters on `provenance` by construction, so membership
written under any other source changes what a context *contains* without
changing which context a trail *is in*. Both halves would go on resolving to
themselves while the sidebar showed the union — wrong in a way that reads as
working. Keeping the merge off the membership rows also leaves every provenance
row exactly as written, so "why is this page in this context" still answers.

**Invariant:** `merged_into` never names a context that is itself merged.
`mergeContexts` resolves both sides to their roots and re-points anything that
pointed at the loser, so resolution is always one hop and a cycle cannot form.
A merged context is excluded from `contexts()` — it is no longer somewhere the
user can switch to — while its members and its last-active time count towards
the context it merged into.

`centroid` is documented above and is **not written by anything**. Filling it in
would have been justified by the merge measurement and was not: scoring two
contexts by the cosine of their centroids is one of the four rules
`agent/jobs/run39.sh` compared, and the mean of the cross pairs beat it on
stability. See `FOSContextMerge.sys.mjs`.

### `context_merge_declined`

An offer the user turned down, so it is never made again. Keyed both ways round,
since "these two are not the same enquiry" is a symmetric statement.

| Column | Type | Notes |
|---|---|---|
| `low_id` | INTEGER FK → `context.id` | The lower of the two ids. |
| `high_id` | INTEGER FK → `context.id` | The higher. |
| `declined_at` | INTEGER | |

Primary key `(low_id, high_id)`.

A rejection is permanent by design rather than by omission. An offer that
returns after being declined is worse than one never made: the second showing
is proof the first was not listened to, and it teaches the user to stop reading
the surface it appears on.

### `context_member`

Membership, with attribution. `source` records *why* something is in a context,
which is what lets a bad clustering decision be explained and corrected.

| Column | Type | Notes |
|---|---|---|
| `context_id` | INTEGER FK → `context.id` | |
| `trail_node_id` | INTEGER FK → `trail_node.id` | |
| `query_id` | INTEGER FK → `query.id` | |
| `weight` | REAL | |
| `source` | TEXT | `embedding` \| `provenance` \| `spatial` \| `manual`. |

Primary key `(context_id, trail_node_id, query_id)`.

### `embedding`

**Vestigial. Nothing reads or writes this table, and that is a decision rather
than an omission.** It was defined for a vector store with staleness rules, and
the model that shipped is a lookup table: an embedding is one sum and a
normalisation, measured at 1.27ms, which is cheaper than the read that would
avoid it. `FOSEmbeddings.sys.mjs` states the same thing at the code. Kept
because a shipped migration is never edited; it will be dropped by a later one
if a heavier model ever makes persistence pay.

On-device vectors. Kept in their own table so a model change can invalidate and
recompute them without touching the records themselves.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `ref_kind` | TEXT | `trail_node` \| `query` \| `context`. |
| `ref_id` | INTEGER | |
| `model` | TEXT | Model id that produced it. |
| `dim` | INTEGER | |
| `vector` | BLOB | Float32, little-endian. |
| `created_at` | INTEGER | |

Unique on `(ref_kind, ref_id, model)`.

### `field_placement`

Where a card sits in the Field, and whether a human put it there.

| Column | Type | Notes |
|---|---|---|
| `trail_node_id` | INTEGER PK FK → `trail_node.id` | |
| `x` | REAL | Field coordinates. |
| `y` | REAL | |
| `pinned` | INTEGER | 1 if the user fixed it in place. |
| `moved_by_user_at` | INTEGER | Null if auto-placed. This is what makes the placement evidence. |

## Deriving a context

Membership is seeded by **provenance**: each trail gets a context, and its nodes
and queries join that one. `context_member.source` records this as `provenance`,
so an embedding pass added later is distinguishable from it rather than layered
invisibly on top.

Provenance rather than a recency window, and the search-log literature is why. A
context inferred from a time gap would be wrong most of the time it mattered:
around 75% of queries are issued while the user is multi-tasking (Lucchese et
al., *Identifying Task-based Sessions in Search Engine Query Logs*, WSDM 2011),
and timeout-based boundary detection tops out near 70% precision on task
boundaries whatever the timeout. Which trail a page is on is not an inference at
all — the user stated it by opening a tab — and `context <mark>` is how they say
otherwise outright.

The active context is therefore **derived, not stored**: it is the context of
the trail you are on, unless you have pinned one. Held as a field it can only
drift, and it did — set once at the first trail, it left a second tab's queries
filed under the first tab's topic.

### Merging is offered, never inferred

Two trails can be one enquiry, and provenance cannot see it: the user stated
that this is a separate line of enquiry by opening a tab, and they were right
at the time. Embedding the two contexts' queries and comparing them is how that
gets noticed, and the measurement is why it is only ever a question.

`agent/jobs/run39.sh` scores the rule over eight enquiries cut in half, so two
halves of one enquiry are a pair that should merge and the other 112 pairs are
not. Chosen on precision rather than F1: a merge never offered costs the user
nothing they had, while a merge offered wrongly spends their attention and, if
accepted, puts two unrelated enquiries in one sidebar. At that operating point
the rule finds about half of the genuine pairs with no false positive among the
112, which is a good question and would be a bad automatic decision.

So there is no confidence at which a merge happens by itself. The only measured
threshold is the bottom one — below it, say nothing — and the offer is made on
a surface the user chose to open rather than on the navigation path.

## Export

"Export context pack" walks one context and writes markdown: the questions
asked, the pages that answered them, and the key entities, ordered so it can be
pasted into an LLM as a brief. It is a pure read over the tables above and adds
no schema.
