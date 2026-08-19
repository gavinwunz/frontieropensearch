# BUILT

Everything this fork has shipped, newest first. Split out of `agent/STATE.md` in
run 42: it had grown to 590 lines of a file whose own header says it is state
and not a log, and every run was reading all of it before doing anything.

This is a record, not a queue. It is the answer to "does the fork already do
this, and what was decided when it was built" — the reasoning in full is in
`agent/JOURNAL.md` under the run that shipped it, and the designs are in
`design/` and `context-engine/`. Nothing here is waiting on anybody; what is,
is in `STATE.md`.

- **`follow` — a mark for a link on the page.** The sixteenth verb, and the
  first that addresses anything *inside* a page. Fifteen verbs addressed the
  browser's own objects; `GRAMMAR.md` §2 had listed in-page links among the
  addressable kinds since marks landed and nothing had ever registered one, so
  the fork had a complete spoken grammar for every surface around a page and no
  hands-free way at all to click a link in one. Run 54's keyset manifest is what
  exposed it, by enumerating the chrome and thereby showing where the chrome
  ends.

  `follow` alone marks the links; `follow cap` follows one. **The optional
  target is forced rather than chosen**: a required target would raise the marks
  only while a slot is pending, and §8's "voice writes the whole line" means a
  voice turn cannot sit in one. **The page gets its own alphabet** — trail nodes
  hold most of the twenty-six letters in any real session and a page has
  hundreds of links that turn over on every navigation, so one registry either
  starves the links or evicts the marks the user has learned. `ScopedMarks`
  resolves a letter by what the pending verb accepts, so `enter cap` and
  `follow cap` are never a choice; stickiness is not excepted, because a link's
  object goes away when the page view does. The parser hands `accepts` *into*
  the lookup rather than comparing after, which would reject a `follow` the user
  could see was correct.

  Letters are drawn in **anonymous content**, as `FinderHighlighter` draws its
  own: the page cannot see them, style them, or be reflowed by them — the three
  failures every extension that injects hints into the page DOM has had. Four
  rules choose what gets one: what is on screen, one mark per destination (the
  thumbnail and its headline share a letter and both carry a badge), the first
  twenty-six in document order **with the count said out loud when it
  truncates**, and the top document only. Past twenty-six is deliberately left
  open with two named candidates in `IDEAS.md`, neither built. `FOSLinkSurface`,
  `FOSLinkMarks`, `actors/FOSLinks{Child,Parent}`, `fos-links.css`.

- **`stop` — giving up on a page that is not coming.** The fifteenth verb, and
  the exit from the state the entry above created. A request that has been made
  and not answered is named by the address bar and reissued by session restore;
  Firefox splits abandoning it in two — `Browser:Stop` aborts the load,
  `handleRevert` takes the request back — and this build could reach neither by
  grammar and only the first by key, because its address bar takes no focus.
  `stop` is both halves in one verb, since neither is any use alone: stopping
  without forgetting leaves the browser naming a destination it is not going
  to, and forgetting without stopping lets the page land a minute later over
  whatever the user did instead. The toolbar's stop button and `key_stop` are
  hooked through the same `Browser:Stop` command event, so all three routes
  leave the same state. Firefox's own tab progress listener does clear the
  field at a failed `STATE_STOP` — what this adds is that the bar and the
  session are right synchronously rather than a round trip later, which is
  recorded in `ARCHITECTURE.md` §7 so it is not later read as redundant. The
  notice names the page that was dropped, which is what makes giving up cheap.
  Placing it added the teach list's fourth group, **"The page"**, and moved
  `search` into it: both belong to the entry surface rather than to a pillar.

- **The page being asked for is shown and remembered while it is in flight.**
  The second missing write found by run 50's lens, and not in a database:
  `browser.userTypedValue` holds a request that has been made and not answered,
  and `FOSActionDispatcher` set it never. Two readers were both wrong — the
  address bar kept claiming the user was still on the page being left for the
  whole of every load, and `TabState.collect` had nothing to carry, so a
  browser killed mid-load came back to the page it was leaving rather than the
  one asked for. The value is the split `resolveInput` already computes: the
  words for a search, the decoded URL for a URL. It goes in with
  `initialPageLoadedFromUserAction`, without which the progress listener skips
  the started-load flag for an initial page over a blank tab and nothing ever
  clears the value again. The redraw is in the dispatcher rather than the
  location display because Firefox's address bar is the surface that was typed
  into and this fork's is not; `setURI` puts it in `pageproxystate="invalid"`,
  which is what withholds the identity box from a page that has not loaded.

- **A page the command bar was asked for is recorded as a typed visit.** The
  fork replaced the address bar, the history menu and the history sidebar with
  one dispatcher and dropped what all three told Places on the way:
  `markPageAsTyped`, whose absence the method's own comment defines — "if this
  is not called visits will be marked as TRANSITION_LINK". So every page a user
  asked for by name was recorded as though a page had linked to it, and because
  the frecency SQL scores a typed visit a tier above a link visit and
  `FOSPlacesFloor` ranks the command bar's fifth tier by exactly that score, the
  fork was demoting the pages its user named and reading the demotion back into
  its own suggestions. A search is marked typed too and kept off the typed
  weight by its source, which Places reads from the `triggeringSearchEngine`
  attribute the load carries — so the engine goes with the mark, and passing
  nothing for a plain URL is what clears the attribute the last search left. The
  private-window guard is not the docshell's: the typed hint is one global
  in-memory map keyed by URL spec with a fifteen-minute life, so without the
  guard a private window marking a page and an ordinary window opening it a
  minute later write a typed visit into the profile. `browser_zztransition.js`,
  17 checks, three mutations all caught. `ARCHITECTURE.md` §7 and `IDEAS.md`
  run 50.

- **A profile refresh carries the Context Engine forward, and a database it
  cannot read no longer strands the browser.** `FirefoxProfileMigrator` — what
  "Refresh" runs — copies an explicit list of files and this fork's database was
  not on it, so the action a user takes when the browser is *already*
  misbehaving silently destroyed every query, trail, dwell time and named
  context while faithfully preserving history, bookmarks, passwords and the open
  session. It is now on the list under `types.HISTORY` beside `places.sqlite`,
  with its rollback journal, and the filename is imported from `FOSContextStore`
  rather than spelled out so a rename cannot silently undo it. That forced the
  second half: a refresh is the repair route, so carrying a file forward is only
  safe if a bad file is survivable. `FOSContextStore.open` now moves a database
  it cannot read aside and starts an empty one — narrowly, on
  `NS_ERROR_FILE_CORRUPTED`/`NOTADB`/`CORRUPT` only, because the cost of a false
  positive is a good record replaced by an empty one — and *keeps* the file,
  since nothing in it exists anywhere else. `FormHistory` keeps its corrupt
  files and `PlacesSemanticHistoryDatabase` deletes its own, and the difference
  is whether the data can be recomputed; this store cannot be. Keeping it
  collided head-on with run 44's promise that everything here can be deleted, so
  `FOSForget.deleteAll` sweeps what was kept — and only `deleteAll`, because a
  moved-aside database cannot be queried and a narrower clear has no way to know
  what is in it. Session restore and the preferences data panel were checked in
  the same pass and need no code, which closes run 44's list. `SCHEMA.md`
  §Recovery and §Permanent private browsing, `design/ARCHITECTURE.md` §7.

- **Private browsing stays out of the database.** A private window wired its
  context engine to the profile's store like any other window, so every URL,
  every line typed at the command bar, every dwell time and every derived
  context label from a private session was written to a file — the mode whose
  entire promise is that nothing is written down was the one place the fork
  recorded most freely. Nothing in `browser/components/fos/` had ever asked
  which kind of window it was in. Private windows now record to a memory
  database: `FOSContextStore.open({memory: true})`, the same schema and the same
  queries, held by `FOSContextEngine.privateStore()` and shared by every private
  window, so the rail, the Field and the sidebar work exactly as they do
  elsewhere and none of it is ever a file. Recording nothing was rejected — the
  browser this forks keeps history, downloads and an address bar working in a
  private window and only declines to persist them, and a private window with an
  empty rail would send the user back to a normal one. Dropped at
  `last-pb-context-exited`, but only when no private window is left, because
  that topic can arrive after a new session has started. Two lines in
  `Sqlite.sys.mjs` so a memory connection can be wrapped at all, both
  connections closed rather than just the wrapper, and private engines ignore
  `fos-context-forgotten` because the two databases number their rows from 1
  independently. `SCHEMA.md` §Private browsing; run 46.

- **Clear-on-shutdown is watched reaching the store.** The nastiest of the four
  integration points run 44 named turned out to need no work — shutdown
  sanitization clears `CLEAR_HISTORY`, which is the flag the cleaner registers
  under, and it runs at `profile-change-teardown`, before the phase where
  `Sqlite.sys.mjs` closes connections. `browser_zzzshutdown.js` executes it
  anyway. Run 46.

- **Forgetting reaches the live session.** Run 44 shipped the store's delete and
  left the window showing what it had just deleted: the rail's tree and the
  Field's cards are in-memory objects built during the session, so a page
  forgotten while it was on screen stayed there until restart and went on
  accruing visits against a row that was gone. `ForgetSummary` now carries
  `nodeIds`, `contextIds` and `all` as well as counts; every window's engine
  observes `fos-context-forgotten` and prunes its own tree, cards and id maps;
  and `TrailStore.forget` applies the store's own rules to the in-memory copy —
  a surviving child climbs to its nearest surviving ancestor, an emptied trail
  goes with its last page.

  **The tab is not closed.** That decision came from Gecko's own source rather
  than from first principles: `SessionStore.onPurgeDomainData` drops every
  closed tab and every tab of a closed window matching the domain and does not
  touch an open one. The tab is left *unrecorded* instead — its browser loses
  its node, so nothing further is written for a page still on screen — and
  navigating onward records again, because forgetting is a delete and not a
  blocklist. A user who wants a session that records nothing has a private
  window.

  The invariant that makes it safe: the tree and the engine's id map move
  together. A node missing from `#nodeIds` is what makes reconciliation decide
  it has never been written and add it, so clearing the map while the tree
  still held the nodes would write every forgotten page straight back.
  `FOSForget` also waits for every window's queue to drain before deleting, so
  a write already in flight cannot land on the far side of the delete.

  A second thing fell out of it: nothing had ever torn an engine down. A
  `WeakMap` made that survivable; a strong observer reference held by a service
  that outlives every window does not, so `attach` now listens for `unload` and
  `detach` runs — which also closes the visit that was open on the window, a
  dwell time that used to be dropped.

- **The bare tap is built, and the standing list's item 1 is closed.** Tapping
  F4 — no modifier — latches a turn; holding it is still push-to-talk. What
  unblocked it was noticing the objection was mis-scoped: "a mis-tap opens the
  microphone for thirty seconds" is equally true of shift+F4, so it was never
  about the tap but about a latched microphone bounded only by a clock.

  So a latched turn now carries two bounds a held turn does not, both named
  after the platform APIs they come from: **initial silence** (6s, nothing was
  ever said — ends the turn with `NOTICE_NOTHING_HEARD` and never runs the
  model) and **end silence** (1.5s, the utterance finished — transcribes). A
  held turn gets neither, because a finger on the key is a user who is present.
  The predicate is "is anybody holding anything", not "which gesture started
  this" — §8's lesson about gesture-shaped bounds, applied before it broke
  rather than after.

  End silence is the half that makes the gesture worth having: the turn ends
  itself when the utterance does, so the second press stops being the only way
  out. `FOSVoiceSession` owns both thresholds; the shell reports the two facts
  only it can see — how long the key was down, and whether the room is above
  `FOSVoiceTranscript`'s own `MIN_RMS` — via an `AnalyserNode` polled at 10Hz,
  not the per-frame worklet run 30 rejected.

  **The bounds are gated on the signal being alive**, and that is not a detail.
  Web Audio needs an *output* device before it will run a graph, so a machine
  without one leaves the context `suspended` reading a flat zero — identical to
  a quiet room — and the bound would have ended a turn six seconds into
  somebody's sentence. `armed({monitored})` is how the turn asks, and a graph
  that has not started within 500ms reports speech once and stops looking.
  Either route lands the turn back on the key and the model's window: **it
  degrades to the previous design rather than past it**, which is the property
  to preserve if these are ever changed.

- **STATE's two narrow defects are fixed, and one of them was two.** Three of
  the Field's four cards were grey, with opposite causes: a page branched *to*
  was never photographed because `#restoring` suppresses the departure re-entry
  starts, and a page branched *from* was never photographed because `enter`
  returns before the restore commits, so the next navigation is still inside
  that window. `enter` announces its own departure now, and a node with no
  picture at all takes one the moment it settles. Separately, a snapshot whose
  document changed underneath it is dropped — `drawSnapshot` reports success
  either way, so the inner window id is the only thing that can tell a correct
  picture from one of the next page. Run 39's journal entry has the detail.

- **Focus custody is a window-level fact and now lives in `FOSChrome`.**
  `takeFocus`/`releaseFocus` keep a stack — the surface that most recently took
  the keyboard gets it back — rather than every surface handing the keyboard to
  the content area on close, which is right only when it was the one thing on
  screen. The command bar is the exception: a line that loaded a page hands over
  to the page, and `FOSActions.loads` counts loads because the verbs cannot tell
  `field` from `wikipedia` — a search reaches the dispatcher as bare prose.

- **The cross-trail merge is offered, measured and driven.** STATE's top item
  since run 36 and now shipped. `FOSContextMerge.sys.mjs` is the pure half —
  `MERGE_FLOOR = 0.244`, the **mean of every cross pair** at d256 — and
  `FOSContextEngine.mergeOffer/acceptMerge/declineMerge` is the wired half. The
  offer renders as the first section of the context sidebar, one candidate
  never a list, and declining is permanent.

  **The plan in this file was wrong and the code says why.** An accepted merge
  was to be `context_member.source = 'manual'`; `contextsForTrails` filters on
  `provenance` by construction, so that changes what a context *contains*
  without changing which context a trail *is in* — both halves keep resolving
  to themselves while the sidebar shows the union. It is `context.merged_into`
  instead (migration 002, with `context_merge_declined`), which also leaves
  every provenance row untouched.

  **The threshold is a new measurement, not run 36's.** 0.201 was one query
  against one query; a context is a set, so the score is an aggregate and needs
  its own distribution. `run39.sh` scores four aggregation rules over eight
  enquiries cut in half. Chosen on **precision, not F1** — a merge never
  offered costs nothing, a wrong one spends attention. `max` tops the table and
  is rejected: it is an order statistic, so doubling the context size lifts its
  different-enquiry p95 by 73% while the mean's *falls*. Recall is ~0.5 at
  precision 1.0 over 112 negatives, on 8 positives — read it as "about half".

  Driven against a real model (`browser_zzmergeoffer.js`, 17 checks): Lisbon
  halves 0.812, baking against keyboards offered nothing. **The misses are
  concentrated, not spread** — `memex` and `sqlite` fall under the floor, which
  are run 36's known weak spots. This works on what you were shopping for and
  not on what you were reading about.

- **The embedding pass is measured, wired, and driven.** `run36.sh` scores
  `potion-retrieval-32M` against the control this fork already ships — Jaccard
  overlap on the `normaliseIntent` tokens the store keeps — on 32 queries
  written the way they are typed and 24 capitalised titles across eight
  enquiries. Static wins everywhere: query→title p@1 0.750→0.938. **The finding
  is underneath the table**: for 11 of 32 queries the lexical arm scores every
  candidate identically at zero, so a third of what a user types produces no
  ordering at all and whatever the store returned first wins. Adopted at
  **d256** — indistinguishable from d512 on this corpus, 30MB against 60MB.
  Cost is a non-issue and has a design consequence: an embedding is 1.27ms
  because the model is a lookup table, so candidates are embedded on demand and
  **the schema does not move**. Silent cross-trail merging is refused by the
  same numbers (best precision 0.756) and *offering* it is what survives.

  Shipped on top of it: `FOSSuggest`'s sixth tier `T_RELATED` ("Close to what
  you typed"), the only tier exempt from `pageMatches` and the only one sorted
  here, and `FOSEmbeddings.sys.mjs`, which owns the engine, caches by text and
  persists nothing. **Verified in a real browser** (`run37.sh`): a page whose
  title shares no word at all with the query is offered, and a page from
  another enquiry browsed in the same window is not. 242 node tests, 670
  browser-chrome checks.

  Two things driving it found that reading could not. **The floor was measured
  over the wrong pairs** — 0.169 came from query→query, and the tier only ever
  compares query→title, whose threshold is 0.173; the constant now names its
  comparison and the measurement takes an explicit second set. **The tier
  cannot reach the Places floor**, because those rows arrive already filtered
  by `frecencyMatches(text)`, so there is nothing lexically-rejected left in
  them to recover; that is a vector store's job and it is not this feature.

  **`browser.fos.suggest.semanticTier` is off by default, and it is consent
  rather than a flag.** `createEngine` fetches the weights if it lacks them, so
  without the pref the first keystroke would have sent a 30MB request to
  Mozilla's model hub that nobody asked for — in a fork that disables update
  and telemetry precisely to avoid that.

- **Three defects a picture found, and the pointer the research said was
  missing.** Run 32's task was the oldest item on the list — two run-23 changes
  that "owe eyes rather than assertions". Looking at them found three things no
  assertion in 656 could have caught. *The rails covered the browser*: both are
  `position: fixed; inset-block: 0` and sit above the toolbox deliberately, so
  the rail hid back, forward and reload and the sidebar hid the page actions,
  the extensions button, the window controls, the app menu and the unseen mark
  itself. `FOSChrome.trackChromeInset` measures the toolbox — it is not a
  constant — and publishes `--fos-chrome-block-start`. *A background arrival was
  becoming "where you are"*: `onLocationChange` fires for every browser in the
  window and `#setCurrent` took the trail of whichever one it was handed, so a
  page loading out of sight moved the active trail, re-lettered the marks, and
  took the sidebar, `what`, `name` and the command bar's tiers with it.
  `currentNodeId` was derived from the selected browser and never drifted;
  `activeTrailId` was pushed and did. *The screenshot run's reset step reset
  nothing* — it used `dismiss`, a Field verb with a required target, which
  parsed as an error and closed nothing, which is why the unseen picture had a
  sidebar and a stale notice in it. **Item 1's question is answered: the 8px dot
  reads at a glance without shouting**, and `shot-unseen.png` is finally the
  picture it was meant to be. The research then closed the loop the dot opens —
  Iqbal and Horvitz (CHI 2007) measured users tabbing through 7.5 windows
  hunting the one that alerted them, so the Field now says *which* card arrived:
  the same dot on the trail's tile, the same accent on the card and its
  miniature, cleared on close rather than on open. 665 browser-chrome checks,
  223 node tests. Pictures: `agent/reports/shot-unseen.png`, `shot-arrived.png`.

- Full Firefox history merged into `agent/dev`; `./mach` works; toolchains on
  `/data`. Full build is ~31m cold, ~4m for a C++ change, seconds for
  `build faster`.
- **Designs written, all three pillars.** `context-engine/SCHEMA.md` (data
  layer), `design/GRAMMAR.md` (command bar, marks, one parse path for keyboard
  and voice), `design/FIELD.md` (pillar A, with four falsifiable acceptance
  properties in §9).
- **Branding complete and verified in the running browser.**
  `browser/branding/frontieropensearch/` with `generate-mark.py` as the single
  source of truth for the mark. App constants confirmed in `config.status` and
  `application.ini`.
- **Phase 1 verified against a live fresh profile, not a grep.** Zero visible
  Firefox/Mozilla strings in the browser window, app menu, menubar and all six
  settings panes. `about:rights` is now a local page instead of a redirect to
  Mozilla's Firefox Terms of Use. Telemetry genuinely off —
  `canRecordBase`/`canRecordExtended` both false. Relay, accounts, VPN/Monitor
  promos off. See `agent/reports/phase-1.md` for the full table.
- **The context engine's writes are correct under two windows.** The store's
  inserts return their own id atomically; `design/ARCHITECTURE.md` §2 records
  the per-window / per-profile split the bug came out of.
- **`design/ARCHITECTURE.md`** — how the three pillars compose, the wiring
  order at window init, the three-layer split, and the full list of files the
  fork touches outside `browser/components/fos/`. Linked from the README.
- **The Field's card and region model.** `FOSField.sys.mjs`: regions that are
  trails, cards seeded by provenance, pinning on first move, the non-occlusion
  push, capacity by eviction then growth, and the three-level overview with
  nesting past nine trails. `FIELD.md` §9's five acceptance properties run as
  xpcshell tests at session scale, plus 21 node tests.
- **`./mach test` works again for browser components.** It never did in this
  tree: see the appdir gotcha below.
- **The command bar, the one entry surface.** `FOSCommandBar.sys.mjs` (DOM
  shell), `FOSCommandBarView.sys.mjs` (pure view model) and
  `FOSActions.sys.mjs` (dispatcher + URL-or-search on `nsIURIFixup`).
  `FOS:CommandBar` now owns accel+L, alt+D, accel+K and accel+E. Empty state
  lists all twelve verbs grouped by pillar; a single token lists the verbs it
  prefixes and Tab completes one, without changing what Enter does. Verbs whose
  pillar has no UI report `NOT_WIRED` rather than falling through to a search.
  36 browser-chrome checks, 11 node tests, verified by screenshot in dark and
  light.
- **The trail rail, and pillar B end to end.** `FOSTrailSession.sys.mjs`
  captures every top-level navigation as a child node, re-enters any node by
  replaying the SessionStore blob it stored (so scroll and form values come
  back), marks the active trail's nodes, and registers `up`, `back`, `branch`,
  `graft` and `name`. `FOSTrailRailView.sys.mjs` is the pure flattening —
  collapse, hoist, spine, selection — and `FOSTrailRail.sys.mjs` renders it on
  the design tokens. The history-sidebar shortcut now opens the rail.
  **Pillar B's promise is verified in a real browser, not only in node**:
  re-entering the root and navigating a second way leaves the first branch whole
  as a sibling, with no duplicate node from the restore. 70 browser-chrome
  checks, 83 node tests.

- **The Field, and pillar A end to end.** `FOSFieldSurface.sys.mjs` renders the
  overview, the region level and the page over the card model, which needed no
  revisiting. `FOSFieldView.sys.mjs` is the pure layout — scale-to-fit at both
  levels, spatial arrow-key movement, lineage — and is tested in node.
  Thumbnails come from `PageThumbs.captureTabPreviewThumbnail`, the tab-preview
  path, taken at the moment a page is departed. A drag calls `moveCard` on every
  pointer move, so mid-drag state is drop state. **F2 toggles page and Field**,
  and `Browser:ShowAllTabs` points at it too. `enter`, `field` and `dismiss` are
  wired; `context`, `pack` and `what` are what remain unwired. 121 browser-chrome
  checks, 96 node tests, verified by screenshot — `agent/reports/field-*.png`.

- **`FIELD.md` §10's deep-tree question is answered, in a new §11.** Lineage is
  transient and shown on focus, not a tree drawn inside every region. PadPrints
  is the evidence for showing hierarchy at all (61.2% of the time on revisitation
  tasks, and *no* time difference on general browsing), the spatial-hypertext
  literature is the evidence against drawing it persistently, and the rail
  already renders the tree properly.

- **First Phase 2 code.** `browser/components/fos/` holds marks
  (`FOSMarks.sys.mjs`), the action table (`FOSGrammar.sys.mjs`), the parser
  (`FOSCommandParser.sys.mjs`) and the trail tree (`FOSTrailTree.sys.mjs`), 37
  unit tests green under `node --test` in ~0.1s via
  `browser/components/fos/tests/node/run.sh`. Wired into
  `browser/components/moz.build`.

- **One design system, written down and applied.** `design/SYSTEM.md` is the
  contract and `browser/components/fos/content/fos-tokens.css` declares it;
  `ensureStylesheet` makes the token sheet a precondition of every other FOS
  sheet, so it cannot be forgotten by a surface. Reconciled across all five
  stylesheets: one type scale, one way to quiet text, one mark, one selection
  treatment, one gutter rule, one weight for "where you are", and the three
  layer integers named. **The headline find is that chrome had no small type at
  all** — see the gotcha below. `browser_designsystem.js` holds the contract as
  109 checks against a running window.

- **The polish pass, and with it Phase 3.** Two defects, both found by opening
  the README's own screenshots at 3× rather than by reading a stylesheet.
  *Rhythm*: the system settled the inline gutter and left the block axis
  unnamed, so the rail and the sidebar — open at once, on either side of the
  page, listing the same nodes — ran at different line rhythms, and the
  sidebar's entity list ran at none and read as a paragraph. Three tokens now:
  `--fos-row-padding-block`, `--fos-list-padding-block`,
  `--fos-heading-space-above`. *Focus*: all three focusable containers fill the
  window, so the ring was a 700px accent rectangle beside a row shaded 20%
  grey. It is on the row now, and on the Field it widens the focused card's own
  frame rather than recolouring it, so pinned and refused still read. Two
  things reading could not have found, both in the gotchas below: the rule
  being replaced was *overriding* the UA's ring rather than adding one, and a
  programmatic focus inherits the window's pointer-or-keyboard mode. The
  sidebar now also opens on the page you are on, as the rail already did.

- **The Context Engine, and pillar C's data layer end to end.**
  `context-engine/migrations/001-initial.sql` is the schema as a versioned
  migration, packaged into the browser jar and read over `chrome://` at open.
  `FOSContextStore.sys.mjs` opens `context-engine.sqlite` in the profile and
  records trails, nodes, queries, visits, entities, contexts and placements;
  `FOSContextSignals.sys.mjs` holds the three pure derivations (normalised
  intent, entities, outcome) and `FOSContextPack.sys.mjs` the markdown export.
  `FOSContextEngine.sys.mjs` reconciles the in-memory tree into the database
  off the trail session, times visits with the clock stopped while the window
  is unfocused, and wires `context`, `pack` and `what`. **All twelve verbs in
  the action table are now wired** — `actions.unwired()` returns empty, and a
  test asserts it. 121 node tests, 39 xpcshell checks, 174 browser-chrome
  checks. Screenshot in `agent/reports/context-what.png`.

- **Trails survive a restart, so pillar B's promise is no longer session-only.**
  `TrailStore.hydrate` adopts `trail` and `trail_node` rows keeping their ids,
  links children in a second pass so a grafted node survives any ordering, and
  validates before it writes so a refused set leaves the store empty rather
  than half loaded; `fromJSON` delegates to it, since an exported trail and a
  database row are the same shape by design. `FOSContextStore.restorable()` is
  the read side and `FOSContextEngine.#hydrate` the caller: it seeds the id
  maps from what it read, which is what stops the next reconciliation writing
  those rows a second time and doubling the tree at every launch. Reconciliation
  also stopped rewriting nodes it has already written, which mattered once the
  session-store blob joined the columns it writes. **Verified in a real browser
  across an actual restart** — `agent/reports/restore-*.png`: the named trail,
  its tree, its titles, its marks and its context all come back, `enter <mark>`
  puts the page up, and the database still holds exactly the rows it started
  with. 128 node tests, 54 xpcshell checks, 184 browser-chrome checks.

- **A restored card is a picture again, so the restore is worth looking at.**
  Departing a page also writes it to Gecko's own thumbnail store, and a card
  with no snapshot of its own paints the stored one over `moz-page-thumb://`.
  Going through `PageThumbs` rather than persisting our own images is what
  gets private windows, about: pages, error responses and uncacheable documents
  refused for free, and `PageThumbs.init()` — which nothing else in this build
  calls — is what makes clearing history clear these too. Driving the built
  browser found the capture itself was the real problem: at departure the
  browser has usually already been swapped, so the picture was of `about:blank`
  or of nothing, and pillar B now also announces a page that has *settled*, one
  second after load, which is where the reliable capture happens. **Verified
  across a real restart**: four pages browsed with the Field never opened, all
  four in the store, and after a restart every restored card painted from it —
  `agent/reports/restore-field-thumbs.png`. 128 node tests, 54 xpcshell checks,
  189 browser-chrome checks.

- **Pillar C's second surface: the context sidebar.**
  `FOSContextSidebarView.sys.mjs` is the pure arrangement — sections, rows,
  relative times, the one-sentence summary and the arrow-key selection — and
  `FOSContextSidebar.sys.mjs` renders it on the inline end, opposite the rail,
  so both can be open at once. Every row re-enters the node it names, including
  the row this surface exists for: **crossings**, the other trails that have
  reached the page you are on, which `crossings(url)` had written and nothing
  consumed. `what` opens it and still answers in a sentence — no verb was
  added, and the sentence and the heading are one string with the label left
  out of the shown half. SearchBar (CHI 2008) is the evidence base and settled
  four design questions, including "no notes field"; see `IDEAS.md`.
  Screenshot: `agent/reports/context-sidebar.png`.

- **The voice path, wired and driven.** `FOSVoiceInput.sys.mjs` is the shell
  `FOSVoiceSession` was designed against: **F4 held** is the turn, the listener
  is on the chrome window in the capture phase (a key pressed with the focus in
  a page reaches the parent only as `BrowserParent::RecvReplyKeyEvent`'s reply
  at the `<browser>`), the bar opens on the press so the words land where the
  keyboard writes, `MediaRecorder` records and one `decodeAudioData` into a
  16kHz `OfflineAudioContext` resamples, and the engine is `onnx-native` on the
  CPU, created at arm time and kept. The weights are the one fetch and the press
  is what asks for it: a machine without them gets the size and the progress,
  never "unavailable" — a download outranks every notice a turn can raise, which
  driving it is what proved (both orderings happen). The indicator the platform
  refuses to draw for a privileged microphone is drawn on the window.
  `VoiceSession` gained `refused()` and `NOTICE_TOO_QUIET`, so a quiet real
  utterance is not told it was silence. **Verified end to end with nothing
  replaced** — `agent/jobs/run30.sh`: armed in 106ms, 2s of audio answered
  513ms after key-up, and Whisper answered a tone with `" (whistling)"`, which
  the adapter's annotation rule refused rather than recording a query nobody
  asked. 218 node tests, 636 browser-chrome checks.

- **The voice path has a second gesture, so it is no longer held-key-only.**
  **Shift+F4 latches**: one press starts the turn, the next ends it, nothing is
  held in between. It is a gesture and not a mode — one flag in `VoiceSession`,
  one modifier arm in `FOSVoiceInput`, one element on the indicator, and the
  same device, runtime, parser and action table a held key reaches. Any press
  ends a latched turn, not only a latching one, because ending early costs an
  utterance where failing to end leaves a microphone open that this build draws
  no platform indicator for. **The find was that the one safety bound was
  defined in terms of the gesture it bounds**: the `LISTENING` deadline ended a
  turn by calling `release`, which a latched turn ignores, so it would have
  bounded every turn except the only one with nobody's finger on the key — and
  silently, since every existing test is a held turn. Both endings go through
  one private step now, and the node property "every way out of every stage
  closes the microphone" runs over both gestures. **Verified live with nothing
  replaced** (`agent/jobs/run30.sh`): latched armed in 106ms *with no key held*,
  a real `MediaRecorder` stayed open across the key-up for a whole 2s utterance,
  and the stopping press turned the turn over in 504ms — against the held turn's
  106ms and 521ms on the same resident engine. `GRAMMAR.md` §8's tenth rule and
  §9, `IDEAS.md` run 31. 223 node tests, 658 browser-chrome checks.

- **Pillar C's third surface: the command bar ranks by active context.**
  `FOSSuggest.sys.mjs` is the ordering and is pure — five tiers, each boundary
  a fact rather than a coefficient: a mark typed as a mark, then the active
  context (best outcome first, in the order `contextContents` already
  justified), then the active trail, then crossings, then Places frecency as
  the floor. `FOSPlacesFloor.sys.mjs` is that last tier, reading Places' own
  read-only connection and its own current ranking column. Two new store reads
  feed the middle: `trailPages` and `contextCrossings`, the second being the
  tier no other browser could offer — what *another* trail found after reaching
  a page this context also reached. `FOSContextEngine.suggest` gathers the five
  and `activate` decides what accepting one means: a page still on a live trail
  is re-entered, so scroll and form state come back, and a page that is only a
  row is loaded. `FOSActions.openURL` is new and exists so that picking a page
  off a list is not recorded as a query. Every tier heading is printed, so the
  ranking explains itself in the surface. 179 node tests, 279 browser-chrome
  checks, 64 xpcshell checks. Verified by screenshot in light and dark —
  `agent/reports/suggest-tiers*.png`.

- **A surface's stylesheet now lands before its first frame.** All four chrome
  surfaces appended a `<link>` on first open, which loads asynchronously, so
  the first frame painted a fixed-position panel as a full-width block.
  `FOSChrome.sys.mjs` loads the sheet with `loadSheetUsingURIString`, which is
  synchronous. Found by a test that opened the rail and the sidebar together
  and measured them.

- **The page you are on is addressable on a trail longer than the alphabet.**
  Marks are assigned at node creation, so first come, first served spent all
  twenty-six letters on the pages opened first — the exact failure the Field's
  eviction rule was written to prevent, arriving from the trail itself. The
  active trail is now considered most recently visited first, and a page may
  take a letter back from an *older page of its own trail* once no retained
  letter is left, never from a page more recent than itself.

- **One entry surface, and it is now true of the mouse.** Two surfaces went.
  The tab strip: `TabBarVisibility` already hides it when "tabs are displayed
  elsewhere" — that is the clause vertical tabs stands on — so this is one more
  condition on the same rule and not a second way to collapse a toolbar. The
  tabs themselves are untouched, and `browser.fos.field.replacesTabStrip=false`
  brings the strip back. The address bar: `FOSLocationDisplay.sys.mjs` sets
  `readOnly` and hands its click to the command bar. It is deliberately *not*
  deleted — origin display is a security boundary, Zen shipped an
  origin-spoofing advisory for hiding it, and the eTLD+1 emphasis, punycode
  handling, certificate state and granted permissions all live in that element.
  Entry moves, display stays. `readOnly` is the supported path: popups and
  taskbar tabs have shipped exactly this for years, so every anchor and panel
  keeps working. With the strip gone the nav-bar takes the titlebar, which
  upstream already handles. Verified end to end: a mouse presses the address
  bar, gets the grammar, runs `field`, and the Field opens. 298 browser-chrome
  checks. Screenshots in `agent/reports/no-tab-strip.png` and
  `one-surface-{rest,rest-dark,open}.png`.

- **The demo flow, and with it Phase 2's acceptance criterion.**
  `tests/browser/browser_zdemoflow.js` drives all five stages as one sequence —
  search, branch three ways, zoom out to the Field, switch context, export a
  context pack — in **its own chrome window**, because each pillar is
  instantiated per window and six files' worth of accumulated cards had
  otherwise already spent the 26 marks the fourth stage needs. It found two
  real defects that six green files could not, both fixed: a query never joined
  its own context, so every pack of an enquiry that began with a search said
  "0 questions asked"; and a pinned context could never be released, so one
  deliberate `context <mark>` aimed the ranking, `what` and `pack` at that
  enquiry for the rest of the session. `context` now takes an optional target
  and the bare form follows provenance again. 335 browser-chrome checks, 179
  node tests, xpcshell green. Screenshots per stage in
  `agent/reports/demo-*.png`, the exported brief in `demo-pack.md`.

- **The Field is measured, and the one real jank is gone.**
  `tests/browser/browser_zzfieldperf.js` times a drag one move per animation
  frame, splitting each move into script, the layout its writes then cost, and
  the interval the refresh driver delivered. **The drag was never the problem**:
  at 40 cards carrying thumbnails a move is 1.5ms of script and 0.01ms of
  layout, and 60 consecutive frames arrived at the display's own 17.08ms
  cadence with none dropped. The cost is `render`, which rebuilds the stage
  from nothing, and the resize listener called it unthrottled — on the worst
  case the design permits (twelve trails, 480 cards, 480 miniatures) one
  rebuild is 17.6ms and ten resize events in one tick cost 53ms of them, taking
  the frame interval during a window drag to a p95 of 65ms against 23ms with
  the Field closed. Now coalesced to one render per frame: the burst is 7.6ms.
  `browser_field.js` holds the behaviour, `IDEAS.md` run 18 the numbers and the
  two hypotheses they refuted.

- **The scripted end-to-end smoke run, and the README's pictures.**
  `agent/smoke.sh` drives the demo flow and then a second, longer session over
  three fixture pages worth reading, leaving eleven screenshots and the
  exported brief in `agent/reports/`. Both files are ordinary browser-chrome
  tests that photograph themselves only when `FOS_SHOTS` names a directory, so
  a normal suite run writes nothing. **The headline find is that every
  screenshot this project has ever taken had a blank rectangle where the page
  was**: `drawWindow` draws the parent process's own layers and content is in
  another process. `DRAWWINDOW_USE_WIDGET_LAYERS` fixes it. The README now
  shows the rail, the Field at both levels, the command bar and the context
  sidebar, all over real pages.

- **The entity extractor keeps names whole.** "The Mother of All Demos" was
  filed as "The Mother" and "All Demos" — found by reading the context sidebar
  in a screenshot, which is the only surface that displays this output.

- **The address bar no longer invites the typing it refuses.** The placeholder
  said "Search or enter address" on a bar made read-only four runs ago. It now
  says "Press to search or run a command", set by overriding `_setPlaceholder`
  rather than by writing the attribute — see the gotcha below.

- **The last second entry surface is gone: the search-mode switcher.**
  Upstream's unified search button wears the default engine's icon — Google's,
  in an ordinary profile — and it is on-screen whenever `pageproxystate` is
  `invalid`, which is every blank tab and therefore the state a fresh window
  opens on. `agent/reports/searchmode-switcher-before.png` is it sitting beside
  the placeholder that reads "Press to search or run a command"; `-after.png`
  is the same window with the bar saying one thing. Everything it offered was
  already unreachable, verified by doing it rather than assumed: picking Google
  set the search mode, painted the chiclet and focused a read-only input, and
  the next keystroke left the value empty. Hidden with `display: none` scoped
  to `[fos-location-display]`, because the button parks itself off-screen
  precisely to stay focusable and returns to the tab order on `focusin`.
  **Two of the seven passthrough selectors named nothing** — the switcher and
  the go button, both classes now that the address bar is an element shared
  with the search bar — so the mouse press had been reaching the command bar
  through a bug, and correcting the selector would have built the surface this
  module exists to prevent. 526 browser-chrome checks.

- **A surface pref now gives the window back, gesture and all.** The two prefs
  that turn a FOS surface off restored the element and not the key: the four
  keys that focus the address bar named `FOS:CommandBar` in
  `browser-sets.inc.xhtml` unconditionally, so a typable bar that no keystroke
  could reach is what `replacesAddressBar=false` had been handing upstream, and
  that is why the previous attempt at pinning **hung** instead of failing. A
  `<key>` resolves its `command` when it fires rather than when it is parsed —
  `XULKeySetGlobalKeyListener::GetElementForHandler` does the `getElementById`
  at dispatch — so a table in `browser-sets.js` points the keys back at window
  init, which is where it has to happen because one FOS command id stands in
  for two upstream ones. `browser.fos.trailRail.replacesHistorySidebar` is new
  and earned it: `browser_sidebar_keys.js` goes from 2 passed / 1 failed to 17
  passed / 0 failed with it. `Browser:ShowAllTabs` follows the Field pref
  through the handler, since a command has no attribute to rewrite. Pinned in
  all eighteen `urlbar/tests/` manifests and both `sidebar/tests/` ones.
  `browser_fosrestore.js` is 20 checks, every one of them with a deadline, so
  the regression comes back as a failure rather than as a stall.

- **A full region takes a drag again.** At exactly the lattice capacity every
  drag was refused, including a drag of less than one seat-step — until the
  dragged card clears the minimum distance from the seat it vacated, its own
  seat is not free either, so `#firstFreeSeat` had nothing to re-seat into.
  §6's ladder already answers this for placement (seed, evict, grow); the drag
  path implemented the first rung and stopped. It reaches the third now and
  skips the second deliberately — eviction bounds the card count against a page
  *arriving*, and a drag brings nothing. Growth is bounded by the arrangement:
  one added row is a whole row of free seats, so twenty successive drags cost
  four rows and then stopped, and every refusal left was
  `would-displace-pinned`. The extent is provisional and committed only when
  the push settles, so a refused drag leaves the height alone. 185 node tests,
  546 browser-chrome checks.

- **The voice path's pure half, which is most of it.**
  `FOSVoiceTranscript.sys.mjs` is the input adapter GRAMMAR.md §5 requires —
  it turns what an ASR model emits into the line the keyboard would have
  produced and knows nothing about actions, marks or the parse — and
  `FOSVoiceSession.sys.mjs` is the push-to-talk turn as a state machine with no
  microphone in it, so every decision the voice path makes is testable under
  `node --test`. **Silence gets two defences, not one**: a recording too short,
  too quiet or too steady is never sent to the model, and a transcript that is
  exactly a known Whisper artifact is refused after — because a short loud
  noise clears every audio gate and is exactly what gets answered with a
  sentence. The cost of getting that wrong is not a wrong command but a query
  the Context Engine records as one the user asked. Cancel works from every
  state including after the transcript arrives, a late transcript after a
  cancel does nothing, and typing wins without deleting what was typed.
  `GRAMMAR.md` §8 is the six rules this settled, including why a misheard word
  is offered by the existing candidate list rather than repaired — a repair
  pass would have to know where free text begins, and §5 forbids the adapter to
  know the grammar. 207 node tests.

- **The ASR measurement is written and gated.**
  `browser_zzvoicelatency.js` loads `whisper-tiny` q8 on both backends, times a
  command-length utterance and a grammar-length one against run 23's ~1s / 2s
  budget, and reports a backend the machine refuses rather than failing on it.
  It measures latency and not accuracy — the audio is synthetic, which is sound
  because Whisper's encoder runs a fixed 30s window whatever it is handed and
  `max_new_tokens` holds the part that does vary at a command's length. Off
  unless `FOS_MEASURE_ASR` is set, since the first run downloads ~75MB.

- **A voice turn can no longer leave a microphone open, which turned out to
  matter more than it sounds.** A chrome window's `getUserMedia` is
  `CallerType::System`, so `MediaManager` sets `privileged` and `askPermission`
  is false — **it never prompts** — and the sharing indicator does not cover it
  either, because `recording-device-events` is observed only by
  `BrowserProcessChild`, a process actor registered without `includeParent` and
  therefore never instantiated in the parent process that holds the microphone.
  No prompt, no indicator, no row in the permissions UI. `VoiceSession` is
  consequently the only thing that can close a microphone it opened: every
  active stage now hands the shell a `deadline`, `blurred()` ends a turn because
  losing focus while holding a key is the ordinary way a key-up goes missing,
  and `expired()` invents no new ending — a listen that runs out is a key that
  came up. `listening`'s cap is Whisper's own 30-second window, so it can only
  end turns whose tail the model was going to discard. The load-bearing test is
  a property rather than a path: every abandoning event from every stage closes
  the microphone and lands on idle. `GRAMMAR.md` §8's seventh rule, `IDEAS.md`
  run 25. 216 node tests.

- **The voice pillar's runtime blocker is closed, and it was never the blocker
  it looked like.** Run 26 read "Unable to get the ML engine from Remote
  Settings" as proof this fork has no offline ML, and `IDEAS.md` run 25 posed a
  choice between vendoring the ONNX wasm runtime and accepting a first-run
  fetch. Both answered a malformed question. The measurement passed `device` and
  never passed `backend`, and `MLEngineChild` reads `opts.backend ||
  BACKENDS.onnx` — so an unnamed backend *is* the wasm backend, and both arms
  asked for the one runtime this build does not contain. **The tree already
  ships a second one:** `onnx-native` runs on `libonnxruntime.so`, which
  bootstrap pulls as a build toolchain and which is already in `dist/bin`
  (10.5MB, every dependency resolves, exports `OrtGetApiBase@@VERS_1.22.0`), and
  `WASM_BACKENDS` excludes it so Remote Settings is never consulted. Nothing is
  vendored, nothing joins git, and a machine with no network has a working
  inference stack on first launch. It is CPU-only and **that costs nothing**:
  whisper-tiny q8 transcribes a command-length utterance in **324ms** and the
  longest utterance the grammar allows in **520ms**, against a budget of ~1s
  natural and 2s tolerable. Load is 1.3s, paid once at arm time. `GRAMMAR.md`
  §8's eighth rule, `IDEAS.md` run 27.

- **The ASR measurement runs, and its weights come off localhost.** mochitest
  aborts the process on any non-local connection, so the measurement could never
  have fetched from a model hub whatever the backend — that is what killed run27
  *after* the native runtime had loaded cleanly. `agent/jobs/local-hub.py`
  imports the handler out of the tree's own `hooks_local_hub.py` and serves
  `/data/ml-models/onnx-models` on a loopback port, because `--hooks` is a
  `mach perftest` flag that mochitest rejects despite `head.js` recommending it.
  `agent/jobs/fetch-whisper.sh` mirrors whisper-tiny q8 there, outside the repo.
  The measurement now skips with an explanation when no hub is set rather than
  taking the browser down with it.

- **The model download is the user's decision, and nothing else fetches.**
  `model` is the thirteenth verb: it names the size (30MB, measured — both
  files, not the headline table) and the host, counts megabytes as they
  arrive, and sets `browser.fos.suggest.semanticTier` only once the engine has
  loaded. The pref means *the weights are here and wanted*, never *a fetch was
  attempted*. Research made the rule bigger than the feature: `ensure` no
  longer fetches at all, because Chrome's May 2026 4GB-model affair turned on
  the complaint that deleting the file got it downloaded again, and this fork
  had built the same thing — a pref set in March standing in for consent to a
  transfer in August. **A stored yes is consent to a state, never to an
  action.** Deleting the model cache now degrades the bar to five tiers until
  the user asks again, which is what makes refusing to build an un-download
  verb honest rather than a corner cut. `IDEAS.md` run 38 has the sources, the
  Firefox Translations comparison, and why the weights come from Mozilla and
  not Hugging Face.
