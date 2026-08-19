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
makes this *worse* here, because nothing is ever deleted by normal use — only
by being asked for, which is Forgetting below. That is the right default for a
browser whose entire promise is not losing things, but it needs a stated policy
rather than silence:

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

## Forgetting

Pruning above is the database's own housekeeping and is deliberately absent.
Forgetting is the opposite thing: the user asked, and every rule in that section
gives way to it — including "never prune a node a context still references",
because a context is derived from evidence and has no standing to outlive the
evidence being withdrawn.

There was no delete of any kind here until schema version 2 had already
shipped, and that was the more serious half of the gap: `nsIClearDataService`
did not know this database existed, so Clear Recent History and Forget About
This Site cleared Places and left the richer record beside it intact. The fork
records more than the history database it replaces — not only which pages were
open but what was typed to reach them, which page each search was typed from,
how long each page was read, and what the whole session was about — so a menu
item that says it is clearing your history and clears half of it is a false
statement, not an incomplete feature. "Everything is local" was true and is not
the whole of a privacy claim; Windows Recall is the case that settled that
argument in public.

Forgetting is `FOSContextStore.forgetHost`, `forgetRange` and `forgetAll`,
reached from the shipped surfaces through `FOSForget.sys.mjs`, which registers
the store as a `CLEAR_HISTORY` cleaner. No new schema was needed: forgetting is
a delete, not a tombstone. A tombstone table would be a second record of the
thing the user asked to have no record of.

Four rules decide what a delete takes with it. Each had a plausible alternative
that loses more than it should.

- **A forgotten node's children are reparented onto its nearest surviving
  ancestor.** Deleting the subtree would mean that forgetting one page forgets
  everything found from it, and those pages are usually on other sites — so
  forgetting one host would take an afternoon of unrelated research with it.
  This is the opposite of the pruning rule above, which refuses to touch a node
  in the middle of a live trail precisely because it would orphan children;
  reparenting is what makes the same operation safe when it is asked for.
- **A query goes with the page it landed on, or — if it never landed — with the
  page it was typed from.** `trail_node_id` is what a query is *about*;
  `source_node_id` is only where the user was standing. A query that landed
  somewhere still remembered is an answer the user still has.
- **A surviving query's `source_node_id` is nulled.** That column is the
  backlink behind the sidebar's "This page made you ask", so leaving it would
  keep a forgotten page addressable through the query table — the one place the
  fork records an association that exists nowhere else.
- **An emptied context is deleted, and merge families are weighed whole.** A
  context's `label` is derived from its own material, so a context whose every
  member has gone is a label naming what was just forgotten with nothing left to
  justify it. Members are counted across the merge family because a merged
  context keeps its own membership rows (see `context.merged_into`), so judging
  one row alone would delete half a live enquiry. Entities and emptied trails go
  by the same argument: a name with nothing behind it.

**What reparenting leaves is an inference, and it is the honest cost of the
first rule.** After forgetting the middle of A → B → C, the trail reads A → C,
which is a navigation that never happened. The edge does not say what was
removed, or that anything was, and nothing is recoverable from it — but the
shape of the branch survives. A caller who needs the shape gone too should
forget the range rather than the host.

**Forgetting reaches the live session, and that is why the summary carries
ids.** The store is the durable record, but the rail's tree and the Field's
cards are in-memory objects built during the session: a store that has forgotten
a page and a window that has not is a browser still showing a record it says it
has deleted, and one that goes on writing visits against a row that is gone.
`ForgetSummary` therefore reports `nodeIds` and `contextIds` as well as counts,
`FOSForget` broadcasts it on `fos-context-forgotten`, and every window's engine
prunes its own tree, cards and id maps to match. `all` stands in for the id list
when everything went — the one case where a list of every id in the database
would say no more than a boolean, and the case where it would be longest.

Two rules make that safe.

- **The tree is pruned first and the id map cleaned to match it, never the other
  way round.** A node missing from the engine's map is precisely what makes
  reconciliation decide it has never been written and add it, so emptying the
  map while the in-memory tree still held the nodes would write every forgotten
  page straight back on the next settle. The map is a record of what is on disk;
  the tree is what the map is about.
- **The in-memory tree forgets by the rules above, to the letter.** Two trees
  that disagree are worse than either, so `TrailStore.forget` reparents onto the
  nearest surviving ancestor and drops an emptied trail exactly as the SQL does.

**The tab is not closed.** A page open when its site is forgotten keeps its
document, its scroll position and anything typed into it; what goes is the
record of it. That is Firefox's own answer rather than an invention —
`SessionStore.onPurgeDomainData` drops every closed tab and every tab of a
closed window matching the domain, and does not touch an open one — and closing
a tab would be a data-loss surprise from a menu item whose whole promise was to
delete data. The tab is left *unrecorded* instead: its browser loses its node,
so nothing further is written for what is still on screen. Navigating onward
records again, because forgetting is a delete and not a blocklist; a user who
wants a session that records nothing has a private window.

## Private browsing

The sentence above was the argument for not building a per-site "never record
this" toggle, and it was false when it was written. A private window wired its
engine to this database like any other window, so every URL, every line typed at
the command bar, every dwell time and every derived context label from a private
session was written to a file in the profile. Nothing in the component had ever
asked which kind of window it was in.

**A private window records to a memory database and never to a file.** Same
schema, same migrations, same queries, same delete graph — `FOSContextStore.open`
takes `memory: true` and changes nothing else, so there is no second, simpler
store that can drift from this one. `FOSContextEngine.privateStore()` holds one
per private session, shared by every private window, and `attach` is the single
place that chooses between the two.

**Recording nothing at all was the other option and is the wrong one.** The
browser this forks keeps full session history, working downloads and a working
address bar in a private window; it declines to *persist* them, not to have
them. Private downloads are the closest precedent in the tree — a separate
in-memory list, dropped when the session ends — and the same shape is right
here. A private window whose rail was empty, whose Field had no cards and whose
sidebar could not answer `what` would not be a private browser, it would be a
broken one, and the user would go back to a normal window to get their work
done, which is the opposite of what the mode is for.

**The lifetime is the load-bearing half.** The store is dropped at
`last-pb-context-exited`, and the private-browsing forensics literature is
largely a catalogue of what happens when it is not: state that survives from one
private session into the next, or onto the disk in a journal after a crash.
Being a memory database answers the second by construction — there is no file to
recover a free list from, which is why the check in `browser_zzprivate.js`
searches the profile database's bytes rather than querying it.

Two things the drop has to get right:

- **The wrapper and the connection under it are both closed.**
  `Sqlite.sys.mjs` treats a wrapped connection as somebody else's to shut down,
  so closing only the handle it hands back leaves the database open for the life
  of the process. Deleted from the browser's point of view and still there from
  a memory dump's is not what this section claims.
- **Nothing is dropped while a private window is still open.**
  `last-pb-context-exited` is the trigger and not the event: it arrives after
  the last private window has gone, and a user who closes one and immediately
  opens another gets the notification on a live session. Observed rather than
  reasoned about — a second private window was on screen when the topic fired
  for the first.

**A private window ignores `fos-context-forgotten`.** The two databases number
their rows independently and both start at 1, so acting on the other one's
summary would drop whichever private page happened to share an id with a
forgotten one. Clearing history is about what is on the disk, and nothing a
private window has recorded is; Firefox's sanitizer does not reach into a live
private session either.

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

**The two node columns are two different edges and both are read.**
`trail_node_id` is where the question *went* — attached once the navigation it
started has arrived, which is why it is null until then and stays null for a
question that opened nothing. `source_node_id` is where it was *asked from*: the
page on screen when the command bar took the line. `store.questionsFrom(url)`
reads the second one, keyed by URL rather than by node so that it reaches every
visit to the same document, and the sidebar shows it as "This page made you ask"
beside the crossings — the same edge read the other way round.

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

`started_at` is written and never read: `dwell_ms` is accumulated as it goes and
is the only form anything asks for. Kept as the raw record behind a derived
number, and noted here so a later audit does not read it as a gap.

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
