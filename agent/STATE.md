# STATE

The agent's working memory. Read at the start of every run, rewritten at the end.
Keep it short — this is state, not a log. History belongs in `JOURNAL.md`.

---

## Phase

**Phase 0 — Bootstrap: COMPLETE** (tagged `phase-0`, report `agent/reports/phase-0.md`).
**Phase 1 — Rebrand: COMPLETE** (tagged `phase-1`, report `agent/reports/phase-1.md`).
**Phase 2 — The novel UI: COMPLETE** (tagged `phase-2`, report
`agent/reports/phase-2.md`, merged to `main`). The acceptance criterion runs as
one automated sequence in `tests/browser/browser_zdemoflow.js`.
**Phase 3 — Beautiful and tested: COMPLETE** (tagged `phase-3`, report
`agent/reports/phase-3.md`, merged to `main`). Full suite green on two
consecutive runs — 18 and 19 — screenshots captured, README complete.

**Every phase in the plan is now done.** What follows is not a phase: it is the
standing list below plus whatever `IDEAS.md` justifies. Do not invent a Phase 4
heading; pick the highest-value item and say in the journal why it was that
one.

## Done

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

## In progress

Nothing waits on a person. **Nothing is running — the harness is free.**

`run32` (the smoke run plus the Field's perf file), `run33`, `run34` and `run35`
all finished green. The last of them left the pictures in `agent/reports/`
current with the tree. `run36` is the embedding measurement and `run37` drives
the tier built on it; both finished green. Their numbers are in `IDEAS.md`
rather than in a picture.

`run39.sh` is this run's: it carries the aggregation measurement *and* drives
the offer built on it. Both green — 17 gated checks, 730 browser-chrome checks,
261 node tests, 135 store checks. It took five attempts and each failure was a
different wrong assumption in the test rather than a repeat, which is the rule
working.

`run37.sh` now also covers the `model` verb against a real cache, and that is
where it earns its keep: it failed three times this run on things no stub could
see. The gated file is the only place in the tree that can ask "did the thing
we just downloaded end up somewhere we can find it again".

The static embedding weights live beside the speech ones at
`/data/ml-models/onnx-models/mozilla/static-embeddings/`, put there by
`agent/jobs/fetch-static-embeddings.sh` (~86MB for both dimensions; a shipped
build needs only d256's 30MB). Same local-hub requirement as every other
measurement here.

Model weights live at `/data/ml-models/onnx-models`, outside the repo, put there
by `agent/jobs/fetch-whisper.sh` (~43MB). `agent/jobs/run30.sh` is the template
for anything that needs the engine; `run29.sh` remains the latency measurement.
Both need `agent/jobs/local-hub.py` serving the weights with `MOZ_MODELS_HUB`
pointed at it, because mochitest kills the process on a non-local connection.

This run needed no gated job either: the voice path's shell decisions are
covered by doubles in `browser_voice.js`, and nothing it touched needs weights.
The suite is 757 browser-chrome checks, 271 node tests and 2 xpcshell files,
all green, plus seven mutation checks confirming each part of the fix is pinned
by a test that fails without it.

`main` is at `phase-3`. `agent/dev` is pushed through this run's commits.

## Next task

The phase plan is complete, so nothing pulls the next run in a particular
direction. Ordered by value. Item 1 for the last three runs — the bare tap —
is built and closed; what is left below is genuinely lower-value than it was,
so a run that finds something better in `IDEAS.md` should take that instead.

Also worth a run of its own at some point: **this file is 110KB and its own
header says to keep it short.** Every run reads it, `IDEAS.md` (179KB) and
`JOURNAL.md` (126KB) before doing anything. The Done section is the part that
has become a log; most of it is recoverable from the journal.

1. **Sustained resize of the crowded overview.** Recorded in `IDEAS.md` run 32
   and *not* solved: the burst is fixed (53ms → 1.19ms) but one rebuild is
   18.27ms p50, longer than a frame, so continuous resizing of the worst case
   the design permits still costs ~21ms a frame over the control. The fix is to
   extend the reposition fast path to cover what `render` rebuilds. Bounded
   value — it is the deliberate worst case, and dragging a window edge with the
   overview up is rare.

2. **Why this build has no remote tabs.** Three upstream urlbar files fail on it
   and the fork is not what breaks them. The next step is
   `UrlbarProviderRemoteTabs.isActive` in a driven browser with
   `services.sync.username` set, not more reading.

3. **The rails still overlay the page.** Run 32 took them off the *toolbar*,
   which was never a deliberate trade; covering the page still is, and STATE has
   always said it belongs with the Field's restructure rather than piecemeal.
   `--fos-chrome-block-start` makes taking layout space a smaller step than it
   was, which is worth knowing when that restructure comes.

4. **The 17 timed-out urlbar files, if they are ever worth it**, and **a
   region's height is a ratchet** (`FIELD.md` §6, open rather than a defect).

## Found this run, not yet chased

- **A feature blocked on a risk: check whether the shipped alternative carries
  the same risk.** The bare tap sat unbuilt for three runs behind "a mis-tap
  opens the microphone for thirty seconds", which is equally true of the
  shift latch that had already shipped. When the risk is shared, it is not an
  argument against the new thing — it is an unbuilt safeguard, and the feature
  is only waiting on it by accident. Nothing about *use* would ever have
  resolved it, which is why three runs of deferring bought nothing.

- **Adding a real-time threshold changes the meaning of every existing test.**
  Six browser tests failed for one cause: the helpers synthesise a keydown and
  keyup faster than any hand can, so every "hold" in the suite became a tap, the
  first turn latched by accident, and the *next* test's press closed that turn
  instead of starting its own. The cascade made it look like the module was
  broken. Any threshold expressed in wall-clock time needs the fixtures audited
  before the failures are read.

- **Measure a gesture from the events, not from the handlers.** Two clock reads
  inside a keydown and a keyup handler measure handler-to-handler, which under
  load is not key-down-to-key-up, and the gap lands exactly on the 400ms
  boundary being decided. `event.timeStamp` on both halves is the interval the
  user actually performed. The first draft read a clock inside the session and
  would have turned a deliberate hold on a busy machine into a tap.

- **The mutation check is cheap and it should be routine now.** Run 39's lesson
  was "revert the fix and re-run before believing a test pins anything". Doing
  it as five targeted mutations rather than one wholesale revert is better still
  — it says *which* test pins *which* line. All seven mutations here were caught
  by exactly the test that should have caught them, which is the first time this
  suite has been checked that way rather than assumed.

- **Two bounds made each other tunable, and neither would have alone.** 400ms
  sits inside the band where a real one-word utterance lives (`MIN_UTTERANCE_MS`
  is 250ms), so the tap/hold call is genuinely ambiguous there. It stopped
  mattering only because end silence exists: a hold misread as a tap latches,
  the user keeps talking, and the turn ends 1.5s after they stop. Worth
  remembering when a threshold looks impossible to pick — the fix may be
  elsewhere.

## Background jobs

`run23` then `run25` — the live chain. Started with
`./agent/bg.sh <name> <cmd>`; check with `./agent/bg-status.sh`. Read these
before starting anything. Each runs as its own transient systemd unit
`fos-job-<name>.service`, in `app.slice` beside `fos.service` rather than
inside it, which is what makes it survive a restart. `agent/logs/<name>.current`
symlinks the live log.

**A chain, not four jobs**, because harness time is exclusive: one mochitest at
a time and no `build faster` across a running one. A job that has to follow
another one belongs in the same script, waiting on
`systemctl --user is-active`, rather than in a second unit that races it.

The upstream tab tests were run to completion this run: **193 of 194 pass**.
The one failure, `browser_bfcache_exemption_about_pages.js`, crashes a content
process on `about:newtab` in a private window and **fails identically with both
FOS surface prefs off** — verified by re-running it that way. It joins the
x11/24.04 family this manifest already skips files for. `agent/tabtests-rest.txt`
is the file list without the three excluded ones.

## Blockers

None.

## Known staged state, not a defect

The rail **overlays** the content area rather than reflowing it, so it covers
the left of the page while open. The context sidebar does the same on the right,
by the same construction and with the same eventual answer. It no longer covers
the *toolbar* — that half was never a deliberate trade, and run 32 took it back
with `--fos-chrome-block-start`. Same construction as the command bar, and
acceptable while both are transient overlays, but a rail meant to be read
*beside* a page eventually has to take layout space. That belongs with the
Field, which restructures the chrome anyway — do not fix it piecemeal first.

`browser_aboutKeyboard.js`'s `testInit` **times out, and did so before this
run's changes** — verified by reverting `browser-sets.inc.xhtml` to its
pre-rail version and re-running, which failed identically. So it is not the
trail rail taking `key_gotoHistory`. It may well be fallout from run 9 moving
`focusURLBar`, `key_search` and friends onto `FOS:CommandBar`, which is worth
checking: if the command bar broke a shipped surface, that is a real
regression rather than an accepted staged state.


**The nav-bar is still there, and that is the claim's real boundary.** What
went is the tab strip and the address bar's *input*. Back, forward, reload, the
extensions button and the app menu are all still in the toolbar, and the app
menu is still the only route to settings, downloads and add-ons. So "one entry
surface" is a claim about **entry** — there is exactly one place text is typed
and one grammar that reaches every verb — and not a claim that the chrome is
gone. Do not describe it as the latter. Hiding the toolbar outright is a much
bigger change than it looks: permission prompts, download notifications and the
identity panels all anchor on elements inside it, and a hidden anchor is a
prompt that appears at the corner of the window or not at all. That wants its
own run and an answer for the app menu first.

**Three upstream tab tests are excluded, and only one of them was ours.**
`browser_1936752_lock_tab_sizing.js` was a real regression — it measures tab
widths that are now zero — and the manifest pref fixed it, so it is excluded
only because it is now covered there. `browser_addAdjacentNewTab.js` and
`browser_audioTabIcon.js` both time out **with both FOS surface prefs off**,
and the first was checked against the pre-run tree by checking it out,
rebuilding and re-running: it fails identically. One right-clicks a tab for its
context menu and one plays audio, and this manifest already skips several files
for `os_version == '24.04' && display == 'x11'`, which is this box. Treat them
as that family and do not spend a run on them.

This matters operationally, not just bookkeeping: **a timeout aborts the whole
directory**, so `./mach test browser/components/tabbrowser/test/browser/tabs/`
stops at the first one and reports almost nothing. `agent/tabtests-rest.txt` is
the file list without them.

**A surface this fork replaces needs its upstream tests pinned, not deleted.**
`browser.fos.field.replacesTabStrip=false` is set in the `tabs/` and `dragdrop/`
manifests. Those files are the coverage that keeps the strip working for the
pref that restores it, and the strip-less window has its own tests. Reach for
the same pattern for the next replaced surface rather than annotating files one
at a time.

**A region is mostly empty until a trail is large.** A region seats 56 cards and
a three-page trail therefore renders as a short column in the middle of a lot of
nothing — visible in `agent/reports/field-region.png`. This is a small-N artefact
and not the desert fog of §2: the region level is scaled to fit and cannot be
panned, so there is no empty view to get lost in, and Data Mountain's subjects
were working with 100 pages. Scaling the region to its *content* instead would
move cards whenever an unrelated card arrived, which is exactly the invariant
§4 exists to protect. Leave it; revisit only with a real session's worth of
pages in front of you.

**Cards seed in a vertical column growing upward.** `#firstFreeSeat` sorts by
distance from the anchor then row-major, and the nearest free seat to a parent
is the one directly above it. It is deterministic and correct, and it does not
read as "provenance" as strongly as a spread would. A tie-break change is a
model change with tests at 40 cards behind it — do it deliberately or not at
all.

**Every file in `tests/browser/` shares one window, and they run in
alphabetical order rather than manifest order.** So nodes, marks and contexts
accumulate across files, and a lookup like `store.nodes().find(n => n.url ===
PAGE_A)` finds the *oldest* match — a node from a trail the test never touched.
Adding one test file re-ordered the suite and made a Field test fail for that
reason alone. Scope a lookup to `activeTrailId` and take the most recent.
This is also the harness that finds mark-pressure bugs: run the whole
directory, never the one file you changed.

**A page reachable by no tier is a page whose history was cleared.** Tiers 2
to 4 each have a precondition and tier 5 is Places, so a row that is on an old
trail, outside the active context, and gone from Places is offered by nothing.
Narrow, and the answer is not a sixth tier holding the whole database — it is
that an old trail should be findable *as a trail*, which is the surface already
deferred below. See `IDEAS.md`.

**The bar re-renders wholesale, so the selection is re-anchored by row id.**
A suggestion read lands after the keystroke that asked for it, and the user may
already have arrowed down. The id of the selected row is read out of the DOM
before the rebuild and looked up again after; a row that has gone takes the
selection back to the typed line rather than handing it to whatever replaced
it. Do not "optimise" this into an index.

**A demo or a flow test wants its own window, not the shared one.** Every file
in `tests/browser/` shares one chrome window, and by the seventh file the 26
marks are gone. `BrowserTestUtils.openNewBrowserWindow()` gives a fully wired
FOS window — `browser-init.js` builds a bar, session, Field, engine and sidebar
per window — over the one shared profile database. That is what a fresh session
is, and it is the right shape for anything testing a sequence rather than a
property. It does not make the mark-budget question below go away; it means a
sequence test is not the place to discover it.

**A named context can fail to get a mark under real mark pressure.** Contexts
take letters only after being named, and only from what the active trail and
the Field's retained cards have left. That is the right priority — pages are
where addressing actually happens — but it means that in the session where
switching context matters most, a Field holding forty cards, `context <mark>`
may have no mark to offer. Caught by a test that passed alone and failed in the
full suite. The candidate fix is to reserve a small number of letters for named
contexts on the argument that the user named them deliberately and there are
few of them; that is a budget change with cross-pillar blast radius and it
wants a decision, not a patch. Search by name is the other answer and is what
`GRAMMAR.md` §2 already specifies for going past 26.

**Restoration is bounded by rank, and only one window gets it.** The twelve
most recently updated trails come back, whole or not at all; a named trail is
not privileged, because naming touches `updated_at` and so a name is recent by
construction on the day it is given and ages out afterwards. Pinning names past
that wants a surface for finding old trails first — restoring them into the
Field forever is how a bookmark graveyard is built. The claim to restore lives
on the store, so the first window to open gets the past and the rest open as
they always did: two windows each holding a copy of one trail would put it on
two Fields and have both reconcile onto the same rows.

**A load that ends where the browser already is adds no node.** That is what
stops a reload growing the tree, and it is what stops a restore's process
switch duplicating the node it just put back. Its cost is real and small: a
form posted to the URL it is already on re-renders a genuinely different page
and now gets no node of its own. Do not narrow this rule back to the restore
path without also solving the reload.

**A query is attached to the next node created after it.** That is right in the
ordinary case — you search, a page opens — and it is a guess if several nodes
are written in one reconciliation pass. Nothing better is available without
matching a search URL against its query, which is engine-specific and brittle.

**Recording is fire-and-forget by design.** A failed write is logged and the row
is dropped rather than retried, because the alternative is a queue that can
stall browsing. So the database is a very good record and not a guaranteed one;
do not build anything that assumes a row must exist.

## Gotchas worth not rediscovering

**A privileged caller loses the user-facing half of an API too.** A chrome
window's `getUserMedia` does not prompt (`privileged = isChrome` in
`MediaManager.cpp`) *and* lights no sharing indicator, because the indicator is
driven by `recording-device-events` and its only observer,
`BrowserProcessChild`, is a JSProcessActor registered without `includeParent` —
so it never exists in the parent process, which is the process recording. The
general form: when the fork calls a privileged API, ask who was going to tell
the user, and check that they are still in the room. Reading the JS will not
show it, because the JS is correct and simply never runs.

**A selector list is a claim about a document, and it fails silently.** Two of
`FOSLocationDisplay`'s seven passthrough selectors matched nothing —
`#urlbar-searchmode-switcher` and `#urlbar-go-button` — because the address bar
became a custom element shared with the search bar, and what were ids on a
singleton are classes on a reusable one. Both failed in the direction that
looks like success: the control quietly loses its press to the command bar,
which is indistinguishable from working until somebody presses that control.
Reading the list cannot find this; one `querySelector` loop against a real
window finds all of it, and `browser_locationdisplay.js` now runs it every
time. Reach for the same guard wherever this fork keeps a list of upstream
selectors.

**Hiding an upstream control: check how it already hides itself first.** The
search-mode switcher uses `position: fixed; top: -999px` under an `offscreen`
attribute, and that is deliberate — it stays focusable, puts itself back in the
tab order on `focusin`, and opens its panel on ArrowDown. Copying the technique
would have moved a Google logo out of sight and left the whole engine list one
Tab away. `display: none` is the only one of the three that leaves the tab
order and the accessibility tree at the same time, and the difference is
invisible in a screenshot.

**One store, many windows: never read connection-wide state after a write.**
`FOSContextEngine.store()` opens one SQLite connection for the whole process and
every window's engine writes through it. Each engine serialises only its own
queue, so statements from two windows interleave as a matter of course. Anything
that asks the *connection* a question after a write — `last_insert_rowid()`,
`changes()`, `total_changes()` — is asking about whatever happened last, from
any window and any table. Use `RETURNING`. This cost three runs and produced a
database referencing rows that had never existed, with no error anywhere: the
wrong id is a perfectly plausible integer.

The reason it looked like a test-harness flake is worth keeping too. Alone, one
window is the only writer and the two statements are correct; in a full suite,
six earlier files have left an engine on the shared window actively recording,
so the interleaving is constant. **"Passes alone, fails in the suite" is not
evidence of test pollution.** It is evidence of concurrency, and the second
writer may well be the product rather than the harness.

**`--font-size-small` does nothing in chrome, and never did.** Upstream's
`toolkit/themes/shared/design-system/src/tokens/base/font.tokens.json` gives
both `font.size.root` and `font.size.small` a *platform* value of `unset`, so
that chrome tracks the OS font size. `font.size.large` has no such override.
The result is a type scale whose upper half applies in a chrome window and
whose lower half silently does not: `font-size: var(--font-size-small)`
resolves to nothing and the declaration falls back to inheriting. The fork had
twenty-two of them across four surfaces, all rendering body text, which is most
of why the surfaces read as flat. Measured, not reasoned:
`getPropertyValue("--font-size-small")` returns the empty string in chrome and
`0.867rem` in an in-content page. Use `--fos-font-size-small`. A token that
resolves to nothing is invisible to stylelint, to node tests and to eslint —
only computed style in a real window can see it, which is what
`browser_designsystem.js` now does for every `--fos-*` token.



- **A test double is only as good as the wiring it copies.** The front end
  assigns `recorder.onLevel` to whatever recorder it currently holds, including
  one installed by `useBackend`, which is what lets a browser test drive the
  microphone's level by hand. A double that had taken the callback in its
  constructor instead would have been wired differently from the real device and
  proved nothing about it.

- **`source agent/env.sh` before any `mach build`.** Without it configure dies
  with `Cannot find ccache`, which reads like a missing toolchain and is only
  an unset `MOZBUILD_STATE_PATH`. `mach test` and `mach lint` do not need it.
- **The devtools MCP forgets `profilePath` on the first restart after a
  restart**, and silently falls back to the objdir profile — which it then
  warns looks like a real profile. Send the full configuration again and the
  second call takes it. Check the warning text before believing a browser came
  up empty.

- **A screenshot of the chrome, without touching the real display.** The X-grab
  route is forbidden (there is no Xvfb on this box, and `:10.0` is Gavin's own
  desktop). The safe route is a scratch browser-chrome test that draws the
  window into a canvas and writes the PNG:
  `ctx.drawWindow(window, 0, 0, w, h, "white")` on a canvas scaled by
  `devicePixelRatio`, then `IOUtils.write` the decoded data URL. Add the file to
  `tests/browser/browser.toml`, run it, read the PNG, and delete both again.
  Every visual defect this project has shipped was found this way and by no
  other means.

- **A test that passes alone and fails in the suite is usually telling you
  something true.** Three separate failures this run only appeared when the
  whole component suite ran in one window, and none was a test-isolation
  nuisance: unnamed contexts were eating the letters pages needed, the active
  context never moved off the first trail, and a global row lookup was finding
  an earlier task's nodes. Run `./mach test browser/components/fos/` before
  believing a green single file.
- **A derived value that could drift will drift.** `activeContextId` was a
  field set once when the first trail appeared, and it silently filed every
  later tab's work under the first tab's topic. It is a getter now, computed
  from the trail the user is on. Same lesson as reconciling the tree by walking
  it rather than mirroring events: if it can be recomputed, recompute it.
- **`PRAGMA user_version` is not transactional in SQLite.** Set it outside the
  transaction that applies a migration, or a rollback leaves the database
  claiming a version it does not have.
- **A single-letter word at the start of free text parses as a mark.** `name a
  research context` set no name, because `a` was read as the optional target.
  Real behaviour of the grammar rather than a bug, and a trap when writing
  tests.
- **An invariant about what the user sees has to be asserted against what is
  drawn.** `FieldModel.overlaps()` was green while the rendered cards overlapped,
  because the caption hung below the box the invariant was checked against. The
  browser test now compares `getBoundingClientRect` between every pair of cards.
  The general form: a model-level invariant tests the model, not the surface.

- **Marks are a budget of 26 shared by every pillar.** A card and its trail node
  are one page and must not take a letter each. Anything that registers marks
  for a new kind of object has to say what it gives up. `FOSTrailSession.retain`
  is how a surface claims letters for pages outside the active trail, and the
  active trail can take one back — retention is a claim, not a guarantee.

- **A chrome overlay needs a very high z-index, not a plausible one.**
  `navigator-toolbox` is a flex item carrying `z-index: 0`, which makes it a
  stacking context that paints over anything lower no matter where in the
  document the overlay is appended. At `z-index: 10` the command bar's backdrop
  dimmed the content area only and left the chrome looking live while the bar
  already held the keyboard. Geometry was correct the whole time —
  `getBoundingClientRect` said full-window — so only a screenshot and
  `elementFromPoint` over the toolbar showed it.
- **`ChromeUtils.defineESModuleGetters(lazy, {Name: url})` binds `lazy.Name` to
  the module's `Name` *export*, not to the module namespace.** So it is
  `lazy.FOSCommandBar.forWindow(...)`, never `lazy.FOSCommandBar.FOSCommandBar`.
- **Synthesised keys do not reach the chrome keyset while focus is in content.**
  A browser-chrome test that opens with `EventUtils.synthesizeKey("l", {accelKey:
  true})` silently does nothing, because focus starts in the remote browser.
  Upstream's own tests use `document.getElementById("Browser:OpenLocation")
  .doCommand()` for this reason. Assert the `command` attribute for the binding
  and use `doCommand()` for the behaviour; synthesise a key only once something
  in chrome already has focus.
- **`stylelint-plugin-mozilla/use-design-tokens` rejects literal CSS values**,
  and the token set is in
  `toolkit/themes/shared/design-system/dist/tokens-*.css`. Worth reading before
  writing chrome CSS rather than after: the tokens already carry dark mode, high
  contrast and forced-colours mappings. Where no token honestly fits — a
  viewport proportion, a measure — use
  `/* stylelint-disable-next-line stylelint-plugin-mozilla/use-design-tokens */`
  with a reason, which is the in-tree convention.

- **A restore is a navigation, and every listener will treat it as one.**
  `enter` puts a page back with `setTabState`, which fires exactly the progress
  notifications a click fires. Left alone it spawned a child of the node just
  re-entered, so going back quietly grew a duplicate spine. Anything that
  synthesises a load has to mark it as its own before starting it — the flag is
  set *before* `setTabState`, not after, because the load can begin
  synchronously.
- **A tab's label describes the page it is about to show, not the one it is
  showing.** It flips to a placeholder when the next load starts, which is
  before the location change that creates the next node — so backfilling a
  title from `tab.label` on trust wrote each page's name onto its predecessor
  and shifted the whole trail by one. Check `browser.currentURI` against the
  node's own URL before believing any tab attribute.
- **`getTabState` lags content, and at the start of a load it is often empty.**
  `{"entries":[]}` is the normal reading for the outgoing page at the instant
  the next load begins. Do not add a retry: read the entry *behind* the current
  page from session history once the new page has settled, where it is complete
  and where waiting costs nothing. The scroll offset is in `entry.presState`,
  **not** the top-level `scroll` key, which only exists while that entry is
  current.
- **A stylesheet appended in the same turn as the measurement has not applied
  yet.** The rail measured 1280x104 — full width, content height — immediately
  after `#build()` appended its `<link>`, and 294x750 a moment later. Nothing
  was wrong. Before diagnosing a layout fault in a surface that builds its own
  DOM, measure again rather than reading the first number.
- **Inspect the running browser, not the tree.** The Phase 1 findings that
  mattered most — a network redirect and a locked pref — are invisible to
  grepping for strings. The harness is the `firefox-devtools` MCP: launch with
  `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` and a scratch `profilePath`,
  `list_privileged_contexts` → `select_privileged_context`, then
  `evaluate_privileged_script`. `screenshot_page` in a chrome context captures
  the **whole chrome window**, which is how the truncated wordmark was caught.
- **Filter by rendered visibility or you will fix non-problems.**
  `documentElement.textContent` includes `hidden` elements. Check
  `getBoundingClientRect()` plus computed `display`/`visibility`.
- **Selecting a privileged context puts WebDriver in chrome mode**, and BiDi
  content navigation (`new_page`, `navigate_page`) then fails with "unknown
  error". Do content-side checks first, or `restart_firefox` to reset.
- **`./mach test` silently broke for every browser xpcshell test the moment the
  app was renamed, and it looked like a packaging fault.** The runner builds its
  appdir manifest key as `mozInfo["appname"] + "-appdir"`, which became
  `frontieropensearch-appdir`, while every in-tree manifest spells it
  `firefox-appdir`. No match meant no `-a`, so `resource:///` never mapped and
  each test died loading its own module; upstream's own tests failed too. Fixed
  in `runxpcshelltests.py` by falling back to the upstream key. **The general
  lesson is the one to keep: a rebrand changes strings that tooling matches on,
  not only strings a user reads.** Look for others.
- Running `xpcshell` by hand still works and is quicker for a one-off, but pass
  `-a .../dist/bin/browser` — the same appdir the harness now gets right.
- `./mach lint` crashes in three linters (`gecko-trace-lint`, `glean-parser`,
  `clang-format`) with `AssertionError` / "Unexpected result type" on
  multi-path invocations. These are infrastructure failures, not findings —
  re-run the specific linter on the specific file (`./mach lint -l clang-format
  -f unix <file>`) to get a real answer. Also pass `-f unix`: the default
  stylish formatter crashes on `TypeError: unhashable type: 'dict'`.
- **A stale, empty `obj*/CLOBBER` demands a pointless full clobber.** The objdir
  file was 0 bytes from configure while the tree's had content, so mach asked
  for a 30-minute rebuild it did not need — the last full build had already
  succeeded against that exact tree. `cp CLOBBER obj-*/CLOBBER` records the
  state a clobber would have left. Check both files before believing the notice.
- `node --test <dir>` only scans a directory whose name matches node's own test
  patterns, which `tests/node` does not; it treats the path as a module and
  fails with `MODULE_NOT_FOUND`. Pass the files, or use the `run.sh` there.
- **`origin` is SSH on a deploy key, and it has to stay that way.** Pushing over
  HTTPS with the `gh` OAuth token fails permanently with *"refusing to allow an
  OAuth App to create or update workflow `.github/workflows/README` without
  `workflow` scope"*, and 20 commits of Firefox history touch that path, so no
  chunking can get past it. The fix is a write deploy key at `~/.ssh/fos_deploy`
  (outside the tree) with `core.sshCommand` set in `.git/config`. If a push ever
  fails on `workflow` scope again, check `git remote -v` first.
- `push-chunked.sh`'s comment claims each chunk boundary fast-forwards the
  previous one. It does not, so some chunks are rejected as non-fast-forward.
  Harmless — the final `push HEAD` catches everything — but do not read those
  rejections as a fault.
- **Never take a full-screen X grab on `:10.0`.** That is Gavin's real desktop,
  not a scratch display. There is no Xvfb on this box. Use the MCP's
  `screenshot_page`, or `./mach run --headless --screenshot`, both of which
  render the browser only.
- A `&&` chain after a `md5sum` of a path that may not exist silently skips the
  rest. Cost a confusing minute when `generate-mark.py` appeared not to run.

- **A performance number needs a control beside it or it is decoration.** The
  first version of the Field harness reported a confident set of drag timings
  for a drag that was refused on every move and never moved a card — the
  numbers looked plausible and were about nothing. Counting committed moves
  cost two lines and caught it. Same shape for the rest: the layout figure is
  only believable because a second flush measured immediately after reads
  0.00ms against the first's 0.01ms, and the resize figure only because the
  same loop was run with the Field closed. **Every measurement in that file has
  a control, and that is why it is trustworthy.**
- **`mach test` does not take `--setenv`; `mach mochitest` does.** The generic
  runner reports it as `UNKNOWN TEST: FOO=bar`, which reads like a bad path
  rather than a rejected option. `agent/smoke.sh` calls `mach mochitest` for
  this reason alone.
- **`drawWindow` does not draw the page unless you ask it to.** The default
  path draws the parent process's own layers and content lives in another
  process, so every screenshot this project took between Phase 0 and now had a
  blank white rectangle where the page was — and it was never noticed, because
  the surfaces being photographed were all chrome. Pass
  `DRAWWINDOW_USE_WIDGET_LAYERS | DRAWWINDOW_DRAW_VIEW`, which snapshots what
  the compositor actually put on screen.
- **A screenshot taken by the harness wears upstream's remote-control
  warning.** A robot icon and red diagonal stripes across the address bar, from
  `:root[remotecontrol]` in `browser/themes/shared/urlbar-searchbar.css`,
  because Marionette is driving the window. It is correct behaviour and it
  documents the test rig rather than the browser, so the capture drops the
  attribute for its own duration and puts it straight back. Anything that
  photographs chrome from a test needs the same two lines.
- **The urlbar placeholder is set again after the window is built.** The search
  service calls `_setPlaceholder` with the default engine's name once it knows
  it, so an attribute written at wiring time survives about a second and then
  becomes "Search with Google or enter address". Overriding the method is the
  seam that holds. The general lesson is the one that keeps recurring: a value
  written once into a surface somebody else also writes will be overwritten,
  and only a test in a real window notices — this looked right in the window
  that produced it.


## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

Merge offer: **0 — closed green at `run39j`.** Five gated attempts, four of
them failing, and not one was a retry of the previous shape: identical query
text across tasks matching at 1.0; the corpus's weak enquiries falling under
the floor; invented fixtures that did not clear it *and* produced a false
positive; a count assertion whose premise about queries-per-navigation was
wrong; a race against the engine load. Every one was the test being wrong about
the product rather than the product being wrong, which is what a gated run
against a real model is for.

ASR measurement: **0 — closed green at `run29`.** It took five attempts and
four of them failed, which is worth keeping as the record of how the rule
behaves when it is working. `run25` died on `Cu.now`; `run26` on an unnamed
backend defaulting to the wasm runtime; `run27` on mochitest killing the
process for a non-local weight fetch; `run28` on `--hooks` being a perftest
flag. Four distinct causes, each strictly further than the last, none of them a
retry of the previous shape.

The counter was right to say **stop** after two, and the stop is what produced
the answer: instead of a third measurement, the next attempt read the tree and
found `libonnxruntime.so` already packaged, which turned "how do we get a
runtime onto the machine" into "we have one". The rule's value here was not
preventing a third try — it was forcing the third try to be a different
question.

The demo-flow flake was counted at three and is now closed by a
root cause rather than by a green run — the change of approach the rule asks
for was "dump the tables instead of re-running", and it worked first time.

The push failure is the one to remember: it failed four runs running and each
run invented a fresh plausible story (transport, process lifetime) rather than
reading the log for a distinct error string. It was an authorisation problem the
whole time, visible as one line among ordinary-looking output. **The
three-strikes rule only works if the counter is actually kept**, so count a
repeated failure even when each run has a new explanation for it.

## Decisions taken

- 2026-08-19 — **A merge is a fact about contexts, never about membership.**
  `context.merged_into`, not `context_member.source`. Provenance decides which
  context a trail is in and the merge is a second statement layered over it, so
  every provenance row survives untouched and "why is this page here" still
  answers. Invariant: `merged_into` never names a merged context.
- 2026-08-19 — **There is no confidence at which a merge happens by itself.**
  Horvitz's three options are inaction, dialogue and action; this fork's band is
  open at the top, so `p*D,A` is unreachable by construction and the only
  threshold that had to be measured is the bottom one. Provenance-before-
  inference is the reason. `IDEAS.md` run 39.
- 2026-08-19 — **A threshold for an offer is chosen on precision, not F1.** F1
  treats a missed merge and a wrong merge as equally bad and this feature does
  not: a merge never offered costs the user nothing they had. So recall ~0.5 is
  accepted deliberately in exchange for no observed false positive.
- 2026-08-19 — **One offer, never a list.** An offer is an interruption and
  three at once is a dialog box asking the user to do the browser's filing.
  Horvitz's eighth principle — doing less, correctly, under uncertainty.
- 2026-08-19 — **Declining a merge is permanent.** `context_merge_declined`
  rather than a session flag, and the button says "and stop asking about these
  two" rather than "not now", because there is no later. An offer that returns
  after being refused proves the first was not listened to.
- 2026-08-19 — **The merge offer stays at d256 although d512 is better at it.**
  d512 reaches precision 1.0 at recall 0.75 against d256's 0.5. The weights are
  a 30MB download this fork asks for by name and run 38 settled the consent
  around that number; doubling it to raise an offer's recall is not a trade a
  user would recognise as theirs. The offer is a second consumer of weights
  already on the machine and is priced accordingly.
- 2026-08-19 — **The offer is computed when the sidebar opens, never on the
  navigation path.** The timing of an offer is part of its cost (Horvitz's third
  principle); opening that panel is a voluntary glance at the same question.
  Same argument as run 22's background-arrival signal.
- 2026-08-19 — **A stored yes is consent to a state, never to an action.**
  `browser.fos.suggest.semanticTier` being on does not authorise a transfer
  now; it records that the weights are here and wanted. So `ensure` never
  fetches, `download` is the only method that may, and clearing the model cache
  is a supported way to reclaim the 30MB rather than a fight with the browser.
  From Chrome's May 2026 4GB download — `IDEAS.md` run 38.
- 2026-08-19 — **There is no verb to un-download the model.** Firefox
  Translations offers a delete and can afford to, because it has a preferences
  pane; this browser has none by design, and `GRAMMAR.md` §4 keeps the table
  small enough to teach entire. A second word for 30MB does not clear that bar.
  Safe only because of the decision above. Revisit if a larger model lands.
- 2026-08-19 — **The search model comes from `model-hub.mozilla.org`**, unlike
  the speech model. Not a preference — `Mozilla/static-embeddings` on Hugging
  Face is the build repository and carries no weights. The line on screen names
  the host because of it.
- 2026-08-18 — **The voice front end never repairs a misheard word.** A repair
  pass would have to know where free text begins, since `name` and `search`
  take the rest of the utterance verbatim, and that is grammar knowledge
  `GRAMMAR.md` §5 forbids the input adapter to hold. The answer is the
  candidate list the bar already narrows live, which is also what Talon does.
  `IDEAS.md` run 24.
- 2026-08-18 — **The in-tree Web Speech API is not the voice path.**
  `OnlineSpeechRecognitionService.cpp` POSTs audio to
  `speaktome-2.services.mozilla.com`: a cloud service, and a Mozilla endpoint,
  either of which disqualifies it. Whisper on the in-tree ML runtime stays the
  path. Its `energy_endpointer.cc` is kept as evidence for the shape of the
  audio gate, not as code to call.
- 2026-08-18 — **The retired address bar carries the unseen state**, because it
  is the only surface this fork keeps permanently on screen. The Field has no
  chrome affordance at all — nothing in the component touches `CustomizableUI`
  — and every FOS surface builds its DOM on first open, so the command bar has
  no resting state either. The bar is the command bar at rest, which makes the
  signal one press from the surface that acts on it. `IDEAS.md` run 23.
- 2026-08-18 — **A page the user navigated to is never an arrival, and neither
  is a restored one.** The state is set only for a card placed for a node that
  is not the selected browser's *and* was created after this window started
  watching. Without the second half every restart would light the mark, which
  is how a badge teaches people to stop reading it.
- 2026-08-18 — **The overview's miniatures are placed in field units under a
  wrapper per region.** All of the scale lives in one `transform` per region,
  so a resize writes about a dozen declarations rather than one per card, and
  the reposition path's write per card became a read per card — the check that
  what is drawn is still the model's, which is the only thing that makes
  leaving the miniatures alone correct.

- 2026-08-18 — **A resize repositions the overview and rebuilds the region.**
  The two levels are not the same problem: a miniature is a plain box that
  should scale with its tile, and a card carries a caption and a mark that must
  not. So the fast path is the overview's alone, and the region keeps the
  rebuild rather than growing a second set of rules for what may follow the
  scale.
- 2026-08-18 — **The reposition path collects its writes before applying any.**
  Every reason it refuses is a difference between what is drawn and what the
  model says, and a refusal found halfway through would leave half the overview
  at each scale — the rebuild that follows would then be repairing a surface
  this path had broken rather than one it declined to touch.
- 2026-08-18 — **The background-tab signal is a persistent binary state, not an
  event and not a drift.** Motion onset captures attention involuntarily, which
  is the attention shift an ambient display is defined by not requiring; a slow
  fade is subject to slow change blindness and is often no signal at all. What
  is left is a step change that persists and is read on the next voluntary
  glance, cleared by opening the Field. See `IDEAS.md` run 22.
- 2026-08-18 — **A failure that follows a timed-out file in an upstream suite
  is a claim about the harness until the file has been run alone.**
  `browser_autoselect.js` produced ten unexpected failures in the directory run
  and passes 40/40 alone. All four of that run's real failures followed a
  timeout.

- 2026-08-18 — **What comes back after a restart is bounded by rank, not by a
  clock.** The twelve most recently updated trails return, whether that is
  yesterday's work or last month's. A time window was the alternative and it
  decides the same question worse: it makes a fortnight away from the machine
  indistinguishable from having finished. Nothing is deleted either way — an
  older trail waits in the database for a surface that asks for it.
- 2026-08-18 — **A trail comes back whole or not at all.** The node budget
  drops whole trails from the tail of the ordering rather than truncating one,
  because a trail missing its middle draws a tree nobody browsed.
- 2026-08-18 — **A load that ends where the browser already is is not a new
  page.** One rule for a reload and for the second half of a process switch,
  rather than a special case for restores.

- 2026-08-18 — **A context is seeded by provenance, never by a clock.** A
  recency window is the obvious implementation and is wrong most of the time it
  matters: around 75% of queries are issued while multi-tasking, and
  timeout-based task-boundary detection tops out near 70% precision. Which
  trail a page is on is a statement the user made by opening a tab, not an
  inference. `context <mark>` is the override, and it pins.
- 2026-08-18 — **The active context is derived, not stored.** Computed from the
  trail you are on each time it is asked for. Held as a field it was set once
  at the first trail and never moved.
- 2026-08-18 — **A context earns a mark by being named.** An unnamed context is
  the trail you are already on, so there is nothing to switch to and the letter
  would buy nothing. This is also what stops contexts spending the alphabet
  pages need — it was found by a node on example.com being addressed as `t`.
- 2026-08-18 — **Migrations stay `.sql` files, packaged and read at runtime.**
  A shipped migration is immutable, and a numbered file that is only ever added
  to is what makes that auditable; it also means the schema can be applied by
  hand with `sqlite3` when something has gone wrong.
- 2026-08-18 — **Recording never blocks browsing.** Every write is queued and
  nothing on the navigation path awaits it; a failed write is dropped rather
  than retried. A lost row is a far smaller harm than a stalled page load.
- 2026-08-18 — **The context pack neutralises markdown from page titles and
  says it vouches for nothing.** Its consumer is a language model and its input
  is page-controlled, so it is an injection surface even though the component
  has no network access at all.
- 2026-08-18 — **The rail may not hide where you are.** Collapse is honoured
  everywhere except on the *ancestors* of the current node, which always render
  open; the stored state is untouched and takes effect again once the user moves
  away. The current node itself may be collapsed, since its children are forward
  branches. See `FOSTrailRailView`'s header, rule 1.
- 2026-08-18 — **Depth is bounded by hoisting, not by truncation**, and hoisting
  is deliberately the same gesture as the Field's zoom so the two pillars share
  one answer to scale. It is a view operation, so it gets no verb and needs no
  spoken form.
- 2026-08-18 — **Marks go to the whole active trail, not to the visible rows.**
  `GRAMMAR.md` §2 makes stickiness the rule that gives marks their value, and a
  letter that changed when a subtree collapsed would be a positional label with
  extra steps. A trail is bounded, so this is within 26 in the ordinary case;
  past that `assign` returns null and those nodes are reached by search, which
  §2 already specifies.
- 2026-08-18 — **Re-entry replays a stored SessionStore blob; it never calls
  `gotoIndex`.** Session history truncates every forward entry the moment you go
  back and navigate elsewhere, which is precisely the destruction pillar B
  exists to prevent. Restoring through it would have destroyed the branch the
  rail is there to show.
- 2026-08-18 — **`back` is time, `up` is structure.** The node you were on a
  moment ago and the node above you in the tree are different questions with
  different answers after a branch, so they keep separate verbs.
- 2026-08-18 — **Each tab opens its own trail.** A tab is already the user's own
  statement that this is a separate line of enquiry; inferring trails from
  navigation timing would guess at something they have said outright.
- 2026-08-18 — **A same-document navigation updates the current node rather than
  adding one.** Provisional, and flagged as such in the code: an application
  that navigates entirely by `pushState` collapses to a single node, and if that
  matters the fix is to compare paths rather than to record every fragment.

- 2026-08-18 — **URL-or-search is decided at execution on `nsIURIFixup`, never
  in the grammar.** It turns on what schemes and hosts exist rather than on how
  the line is shaped, so it is not syntactic; putting it in the parser would
  also cost the grammar its node test suite and give the transcript front end a
  second thing to agree with. See `design/GRAMMAR.md` §7.
- 2026-08-18 — **The bar opens showing all twelve verbs, grouped by pillar.**
  The standard palette critique — do not withhold what the menus expose — does
  not apply, because there are no menus; but that removes the safety net rather
  than granting one, so this is the only surface that can teach the vocabulary.
- 2026-08-18 — **A prefix is offered, never triggered.** A single token lists
  the verbs it prefixes and Tab completes one; Enter still searches. Changing
  what is *shown* is safe, changing what Enter *does* would be the mode §3
  exists to prevent. Tab needs no spoken form because it reaches no action.
- 2026-08-18 — **An unwired verb reports `NOT_WIRED` and stops the chain.** It
  must not fall through to a web search — that is exactly the hijack the
  fallback rule prevents — and it must not be skipped, because a later verb in
  a chain usually depends on what an earlier one did.

- 2026-08-18 — **A push chain that reaches a region edge re-seats the unpinned
  card it was pushing instead of refusing the drag.** Refusing there made most
  drags in a busy region fail while the vacated seat sat empty. An unpinned card
  has no position the user chose, so re-seating it is as legitimate as seeding
  it. Refusal is now only ever about a position the user owns.
- 2026-08-18 — **Placement never fails.** A full region evicts one
  least-recently-used *unpinned* card, and grows if that does not free a
  reachable seat. Navigation drives placement, so it cannot be allowed to
  refuse. Recorded in `FIELD.md` §6.
- 2026-08-18 — **VPSC and the node-overlap-removal literature are rejected for
  the drag path**, because they are batch and globally displacement-minimising
  and so cannot give the mid-drag guarantee, and because they have no way to
  express refusal. See `IDEAS.md`.
- 2026-08-18 — **Field tests run at session scale (40+ cards), not at three.**
  Both defects so far were density effects that a small case cannot reach.
- 2026-08-18 — **Telemetry is switched off in `TelemetryPrefValue()`, not in a
  pref file.** `SetupTelemetryPref` locks the pref, so a branding pref line is
  silently ignored; leaving one in place would read as a guarantee it cannot
  give. Deleted it and left a comment saying where the real switch is.
- 2026-08-18 — **The fork names Mozilla and Firefox on purpose in exactly two
  places**: the MPL attribution and the not-affiliated notice, in the about
  dialog and `about:rights`. These are excluded from the CO01 Fluent lint,
  because writing them with `{ -brand-* }` terms would resolve to the fork's own
  name and make the disclaimer say nothing. Everywhere else, zero.
- 2026-08-18 — **Mozilla services are switched off, not rebranded.** Relay,
  Firefox Accounts, VPN and Monitor promos each carry a network path to Mozilla,
  and the fork has no account system. Renaming them would have been a lie.
- 2026-08-18 — **A page carries one mark, and it belongs to its trail node.**
  A card is that page's presence on the Field, not a second object to address,
  so `enter` and `dismiss` take a node. Giving cards their own letters spent two
  of the twenty-six on every page, and the rail lost its marks in a session of
  ordinary size. It also makes `FIELD.md` §8 sayable: the mark survives the
  dismissal that removes the card, so `enter <mark>` is what brings it back.
- 2026-08-18 — **The overview lays out the slots that hold something**, not all
  nine. Sizing for nine left two thirds of the window empty at three trails.
  `§5`'s landmark property is carried by the model's permanent slot indices — a
  region never reorders against another — rather than by the grid's shape.
- 2026-08-18 — **A line is a command only if every token parses as one.** Eight
  of the twelve action words are ordinary English, so `what is a memex` returned
  a syntax error. Syntactic failure now falls back to a query; semantic failure
  on a real mark stays an error. Chrome made the same call in 88.0.4324. See
  `design/GRAMMAR.md` §3.
- 2026-08-18 — Fork-owned design specs live in `design/`. `docs/` at the repo
  root is upstream Firefox's and is not ours to fill.
- 2026-08-18 — Every addressable object carries a **mark**: one letter, shown,
  spoken as its Talon-alphabet word. Typing `c` and saying "cap" resolve through
  one path, which is how "no separate accessibility mode" is met. Marks are
  sticky for an object's lifetime.
- 2026-08-18 — The captured navigation tree and a **Trail** are different things.
  Capture is automatic and total; a Trail is a named, curated selection promoted
  out of it. This is what distinguishes pillar B from Nyxt's shipped history tree.
- 2026-08-18 — The Field is **bounded**, not an infinite canvas. Jul and Furnas
  on desert fog: an infinite plane is almost all empty, so almost every reachable
  view has nothing to navigate by. Recorded in `design/FIELD.md` as a deliberate
  departure from the phase plan's wording.
- 2026-08-18 — Name fixed as Frontier OpenSearch. See `BRANDING.md`; do not
  revisit.
- 2026-08-18 — Upstream is a git remote, not a vendored copy, with its push URL
  set to `no_push`.
- 2026-08-18 — All build state lives on `/data`; `~/.mozbuild` is a symlink.
  Source `agent/env.sh` before any mach command.
- 2026-08-18 — `mozconfig` is checked in and portable — no absolute paths.
