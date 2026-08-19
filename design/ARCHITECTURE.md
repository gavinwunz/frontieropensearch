# Architecture

How the three pillars fit together, and where each one lives in the tree.

The pillars are specified separately — `design/FIELD.md` for the Field,
`design/GRAMMAR.md` for the command grammar, `context-engine/SCHEMA.md` for the
Context Engine's data layer, `design/SYSTEM.md` for how all four chrome surfaces
are styled. This file is the one that says how they compose, because that is the
part none of them can state alone.

---

## 1. One spine, two readers

The three pillars are not three peers. There is one spine and two things that
read it.

```
        capture                     ┌── the Field  (pillar A) ── a view of the tree
  navigation ──► Trails ───────────►┤
                (pillar B)          └── the Context Engine (pillar C) ── a record of it
                the spine
```

**Trails is the spine.** Every navigation becomes a node on a tree, and nothing
else in the fork captures navigation. The Field does not track pages and the
Context Engine does not observe loads; both are told by pillar B.

That direction is the reason a region in the Field *is* a trail rather than
resembling one, and the reason a context is seeded by which trail a page is on
rather than by a clock. Two features that each invented their own idea of "a
group of related pages" would drift apart within a session, and the user would
be the one who had to hold both models. There is one grouping, stated by the
user when they opened a tab, and the other two pillars adopt it.

The arrow never runs backwards. The Field may move a card and the engine may
pin a context, and neither writes a node. If a surface needs the tree changed,
it asks pillar B.

## 2. Per window, per profile

Two lifetimes, and confusing them has cost this project real bugs.

**Per window.** Each of `FOSTrailSession`, `FOSFieldSurface`, `FOSCommandBar`,
`FOSContextEngine` and `FOSContextSidebar` is instantiated once per chrome
window through `forWindow(window)`. A window is a session: its own tree, its own
cards, its own marks, its own active context. Two windows are two workspaces,
which is what makes a second window a useful thing to open rather than a
duplicate of the first.

**Per profile.** The `FOSContextStore` — one SQLite file — is opened once for
the whole process by `FOSContextEngine.store()` and shared by every window.

The seam between those two is where the sharp edges are. Each window's engine
serialises its own writes onto its own queue; the store serialises nothing
across windows, so two windows' statements interleave on one connection as a
matter of course. Anything that reads connection-wide state after a write is
therefore wrong by construction — `SELECT last_insert_rowid()` after an INSERT
returned another window's row for months, and the resulting database referenced
rows that had never existed. Inserts now use `RETURNING id`. The rule the bug
leaves behind: **on the shared store, one statement per fact.**

## 3. Wiring order

Pillars attach at window init, in `browser/base/content/browser-init.js`, and
the order is load-bearing:

1. **The command bar** is constructed first, because the other three register
   their verbs and marks on it.
2. **Trails** wires next. Capture has to be listening before the first
   navigation — a tree missing its own root is worse than no tree.
3. **The Field** wires after Trails: a region is a trail, so it would have
   nothing to place cards into if it went first.
4. **The Context Engine** wires last and attaches asynchronously, un-awaited. It
   is the only pillar that opens a file and so the only one that can fail at
   startup, and a window must not wait on a disk. A store that will not open
   costs the user their record, not their browser.

## 4. Three layers, repeated four times

Every pillar is built the same way, and the split is what keeps most of the
logic testable without a browser:

| Layer | Knows about Gecko | Example |
| --- | --- | --- |
| **Model** | no | `FOSTrailTree`, `FOSField` |
| **View model** | no | `FOSTrailRailView`, `FOSFieldView`, `FOSCommandBarView`, `FOSContextSidebarView` |
| **Surface** | yes | `FOSTrailSession`, `FOSFieldSurface`, `FOSTrailRail`, `FOSCommandBar` |

A model decides *what is true* — where a card goes, what the tree's shape is. A
view model decides *what should be drawn* — a tree flattened into rows, a parse
result turned into a description of the bar. Only the surface touches a
document, a browser, or a session history entry.

The payoff is that geometry, ranking, flattening and rendering decisions run
under `node --test` in milliseconds. The limit is equally real, and this project
has shipped two bugs that green node tests could not see: **a pure test proves
the decision, never the wiring.** Anything crossing into Gecko needs xpcshell or
browser-chrome.

## 5. One entry surface, one parse path

There is no URL bar, no search box and no menu for any of this. The command bar
handles search, URLs, verbs, trail jumps and context switches, and the address
bar has been reduced to displaying the address (`FOSLocationDisplay`).

Behind it there is exactly one parse path:

```
  keystrokes ─┐
              ├─► FOSCommandParser ─► FOSActions ─► the pillars
  speech    ──┘        (pure)          (effects)
```

`FOSGrammar` is the single action table both modalities read, and
`design/GRAMMAR.md` §5 forbids an action reachable by only one of them. This is
why there is no "accessibility mode": a hands-free path is not a parallel
implementation of the UI, it is a second front end onto the same parse. A verb
that works when typed works when spoken because there is nothing else it could
do.

**Marks** (`FOSMarks`) are the addressing layer that makes that possible. Every
addressable object — a Field card, a trail node, a named context — carries a
letter, and every letter has a spoken word form. `enter g` and "enter gust"
reach the same object through the same resolver.

## 6. What the Context Engine records, and what it never blocks

`context-engine/SCHEMA.md` is the authority; the shape in one paragraph:
`trail` and `trail_node` mirror the spine, `query` records what was asked,
`visit` records dwell and outcome, `entity_mention` records what a page was
about, `context` and `context_member` are the clustering, and `source` on a
membership row says *why* a page was filed where it was, so a bad clustering
decision can be explained rather than merely reversed.

Two rules hold everywhere:

- **Recording never blocks browsing.** Every write goes through the engine's
  queue and nothing on the navigation path awaits it. A failed write is logged
  and dropped — a lost row is a far smaller harm than a stalled page load.
- **The tree is reconciled, not mirrored.** Pillar B announces that its tree
  changed, not what changed, and the engine walks it and writes what it has not
  seen. An event stream would have to be separately right about branches,
  grafts and restores; walking cannot drift.

The store is read by three surfaces — the command bar's ranking, the context
sidebar, and the exported pack — and all three go through the single
`contextContents` read, so what the user is shown and what they export can never
disagree.

The sidebar makes two reads beside that one, and they are the exception that
proves the rule: `crossings(url)` and `questionsFrom(url)` are scoped to the
**page** rather than to the context, so `contextContents` could not answer them
without ceasing to be one read. They are the two directions of one edge —
`trail_node.url` for what reached this page, `query.source_node_id` for what it
sent you on to ask — and they are the only place this fork has anything like a
bi-directional link. It can afford one because it owns both ends and nobody else
can write to them; that is the condition the open web never had.

## 7. The boundary with Firefox

Every module above lives in `browser/components/fos/`, is packaged by that
directory's `jar.mn`, and reaches Gecko only through public APIs. The three
pillars add nothing outside that directory.

What they do need outside it is small and worth listing in full, because the
size of this list is the thing that keeps `./mach build faster && ./mach run` an
inner loop of minutes rather than hours:

| File | Why |
| --- | --- |
| `browser/base/content/browser-init.js` | the wiring block in §3 |
| `browser/base/content/browser-sets.{js,inc.xhtml}` | the keys the pillars bind |
| `browser/components/tabbrowser/content/tab-bar-visibility.js` | the tab strip stays hidden — the Field replaces it |
| `browser/base/jar.mn`, `browser/components/moz.build` | packaging |
| `browser/components/about/AboutRedirector.cpp` | `about:rights` is a local page, not a redirect to Mozilla's terms |
| `toolkit/components/cleardata/ClearDataService.sys.mjs` | the Context Engine is registered as a `CLEAR_HISTORY` cleaner |
| `toolkit/modules/Sqlite.sys.mjs` | a memory database can be wrapped, so private browsing has a store |
| `browser/components/migration/FirefoxProfileMigrator.sys.mjs` | a profile refresh carries the Context Engine's database forward |
| `browser/base/content/sanitize_v2.xhtml`, `sanitizeDialog.js` | Clear Recent History says what it will take out of the Context Engine |
| `browser/components/places/content/clearDataForSite.{xhtml,js}` | so does Forget About This Site |

The last row is two lines: `wrapStorageConnection` read a name off a
`databaseFile` that a memory database does not have, so the documented way to
get an async memory connection could not be used with the module every other
store in the tree goes through. It is upstream's bug rather than the fork's, and
the change is a `?.` and a fallback name.

The row above it is the substantial edit outside `browser/`, and it is there
because the
service has no runtime registration API — a cleaner is a literal in a table in
that file, so being reachable from Clear Recent History means editing it. The
edit is kept to a delegation behind a `MOZ_BUILD_APP` guard, with everything it
does living in `FOSForget.sys.mjs`, so the upstream diff stays a few lines and
the reasoning stays with the component that owns the data.

Only the last of those is C++, and it is a rebranding requirement rather than a
pillar's. Everything else in the fork's own diff is the branding directory
(`browser/branding/frontieropensearch/`) and prefs.

**The list above is what the fork asks of Firefox. The harder question is what
Firefox already does *to* the fork's data**, and a short list of touched files
is exactly what hides it: every integration point Gecko exposes and the fork has
not implemented is a claim the fork is silently making. `nsIClearDataService`
was the first one found — Clear Recent History cleared Places and left the
richer record beside it — and it was not the last.

**Private browsing was the second, and is worse than the first.** A private
window ran the wiring block in §3 like any other window and got the profile's
store, so a mode whose entire promise is that nothing is written down was
writing every URL, every query and every dwell time to a file. The first defect
was data the user could not delete; this one was data that should never have
existed. The fix is in `SCHEMA.md` §Private browsing, and the general lesson is
in the shape of the two: both were found by asking what Firefox does *to* this
component rather than what the component does, and neither was visible from
inside `browser/components/fos/`, where every test passed throughout.

**Sanitize-on-shutdown turns out to be already covered**, which is worth
recording as carefully as a defect would be. `Sanitizer.onStartup` adds
`sanitizeOnShutdown` as a blocker on Places' clients-shutdown client, which
blocks `profile-change-teardown`; its history item calls
`nsIClearDataService.deleteData` with `CLEAR_HISTORY`, and that is the flag the
Context Engine's cleaner is registered under. So the store is cleared, and it is
cleared at `profile-change-teardown`, before the `profile-before-change` phase
where `Sqlite.sys.mjs` closes connections — which is the part that could have
been wrong and was not. `browser_zzzshutdown.js` runs it rather than trusting
the reading.

**Profile refresh was the third, and it loses everything at once.**
`FirefoxProfileMigrator` is what "Refresh" runs, and it is deliberately lossy:
it copies an explicit list of files — history, favicons, cookies, passwords,
form data, the dictionary, bookmark backups, the session — and leaves the rest,
because the point of a refresh is to drop whatever configuration might be
causing the trouble. The Context Engine's database was not on that list. So a
refresh returned a browser with its history and bookmarks intact and its rail,
its Field and its sidebar empty, having silently discarded every query typed,
every trail walked, every dwell time and every named context.

The database is now on the list, under `HISTORY` beside `places.sqlite`,
because it is the same *kind* of thing: a record of browsing rather than a
setting, and one with no second copy anywhere on the machine. Its rollback
journal is copied with it for the same reason `places` copies its `-wal` — a
source profile that crashed has a hot journal, and a database copied without it
is a recoverable crash turned into an unreadable file. The filename is imported
from `FOSContextStore` rather than spelled out, because a missing file here is
indistinguishable from a profile that never ran the engine, so a rename that
broke this would stay invisible until somebody refreshed.

That change forced a second one. A refresh is the route a user takes when the
browser is misbehaving, so carrying a file forward is only safe if the browser
can recover from that file being bad — otherwise refresh, the repair action,
stops repairing. `FOSContextStore.open` now moves a database it cannot read
aside and starts an empty one; it *keeps* the unreadable file, because nothing
in it exists anywhere else, and `FOSForget`'s `deleteAll` sweeps what is kept so
that keeping it stays compatible with the promise the previous paragraph but
one exists to make. `SCHEMA.md` §Recovery has the rules.

**Session restore and `about:preferences`' data panel need no code**, and both
answers were already in the tree. Session restore's two purge paths were settled
in run 45 — `onPurgeDomainData` and `onPurgeSessionHistory` remove closed tabs
and leave open ones alone, which is the rule `SCHEMA.md` §Forgetting adopts
verbatim — and what the panel offers for this data is Clear Data, which is
`CLEAR_HISTORY` and therefore the cleaner above, and "Never remember history",
which sets `browser.privatebrowsing.autostart` and so makes every window
private and every store a memory store by §Private browsing's existing rule.
The panel's other half, Manage Data, is site data in the quota sense — cookies
and cache, per origin — and this store is neither.

Forgetting is also where the fork's own data crosses back over that boundary in
the other direction. The store is per profile and a session is per window, so
`FOSForget` broadcasts what it deleted on the `fos-context-forgotten` observer
topic and each window's engine prunes itself: there may be no windows open or
five, and the store must not have to know which. §6's rule that recording never
blocks browsing is suspended for exactly one operation — a clear waits for every
window's queue to drain before deleting, because a write already in flight would
otherwise land on the far side of the delete and put back a row the user has
just asked to be rid of.

The last two rows in the table above are the other half of that crossing, and
they are the first edits the fork has made to a Firefox *surface* rather than to
a Firefox *service*. They stay small on purpose: one hidden element in each
dialog and a guarded call, with the sentence and every decision behind it in
`FOSForgetPreview.sys.mjs`. The reason they exist at all is that the two dialogs
are honest for Firefox's data and were not for this fork's — Firefox's history
is a flat list, so "the last hour" describes its own blast radius, and this
store's does not. `SCHEMA.md` §Saying what will go, before it goes has the
argument, including why the preview is the delete rolled back rather than a
second set of counting queries.

**The reverse question — what the fork writes into *Firefox's* data — had never
been asked, and it had one answer.** Every question above starts from Firefox
and looks at this store; this one starts from the dispatcher and looks at
`places.sqlite`. Places does not record a visit the same way for every caller:
`nsINavHistoryService.markPageAsTyped` is how a piece of chrome declares that
*it*, and not a link on a page, asked for the URL, and the method's own comment
states the default — "if this is not called visits will be marked as
TRANSITION_LINK". Firefox declares it from the address bar
(`UrlbarUtils.addToUrlbarHistory`), the history menu, the history sidebar and
the places organiser. `FOSActionDispatcher` is the one surface that replaced all
four, and it declared nothing, so every page a user of this fork asked for by
name was recorded as though a page had linked to it.

It is not a mislabelled row. `SQLFunctions.cpp` scores a typed visit at
veryHigh/high and a link visit one tier down at high/medium, and `FOSPlacesFloor`
— the command bar's fifth tier — deliberately takes Places' own ordering rather
than inventing one. So the two halves of this fork were working against each
other: the dispatcher demoted the pages the user had named, and the floor read
the demotion back in as though it were Places' opinion. The floor's comment says
it "reads history without being able to alter it", and that stays true of the
floor; the alteration was upstream of it, in the module that asks for the loads.

The search half is the same fact from the other side, and is why the fix is two
things rather than one. Firefox marks a result page typed like anything else and
keeps the typed weight off it by the visit's *source*: the frecency SQL excludes
`v.source IN (1, 3)`, and source 3 is set in `History.cpp` from the
`triggeringSearchEngine` attribute that `Tabbrowser._updateTriggerMetadataForLoad`
puts on the browser element. Marking typed without passing the engine would not
have been half a fix — it would have ranked every result page above the pages
found from it. The dispatcher passes `globalHistoryOptions` for a search and
nothing for a URL, and the nothing matters too: it is what clears the attribute
a previous search left behind.

The private-window guard on the mark is not redundant with the docshell's
refusal to record private visits. The typed hint is not private state — it is
one in-memory set keyed by URL spec with a fifteen-minute life — so a private
window marking a page and an ordinary window opening the same page a minute
later would have written a typed visit into the profile on the strength of
private browsing. That is the same class of defect as the second one in this
section, arriving by a route that has nothing to do with this fork's store, and
`browser_zztransition.js` is where all of it is asserted.

Upstream Firefox guidance in `AGENTS.md` and `docs/` still applies to everything
below that line.

## 8. How it is tested

Four levels, each catching what the one below it cannot:

| Level | Where | What it proves |
| --- | --- | --- |
| `node --test` | `tests/node/` | Model and view-model decisions, with no browser |
| xpcshell | `tests/unit/` | The store against real SQLite — migrations, constraints, the queries behind `what` and `pack` |
| browser-chrome | `tests/browser/` | Each pillar in a real window: capture, re-entry, keys, focus, rendering |
| the demo flow | `tests/browser/browser_zdemoflow.js` | That the five stages of Phase 2's acceptance criterion *compose* |

The last one is deliberately a single task in its own chrome window. The other
files each prove one pillar from state they set up themselves, which is exactly
why none of them can see whether the pillars work in sequence — and a sequence
is where the seams between three pillars show.

## 9. What is deliberately absent

- **No cloud, no account, no sync, no telemetry.** The store is a local file and
  the component has no network access at all. This is a constraint on the
  design, not a setting: a feature that needs a server does not get built.
  Local is half of the claim and not the whole of it: a record the user cannot
  remove is not private merely for staying on the machine, so everything the
  engine holds is reachable by the clearing surfaces Firefox already ships. See
  `context-engine/SCHEMA.md` §Forgetting.
- **No tab strip and no linear history.** Not hidden — replaced. Anything that
  reintroduces "the list of things you have open" as the primary model is a
  regression however convenient it looks.
- **No fourth paradigm.** An idea that does not strengthen the Field, Trails or
  the Context Engine does not land, however good it is on its own.
  `agent/IDEAS.md` records what was rejected and why, so it is not reconsidered
  from scratch in three runs' time.
