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

**Moved to `agent/BUILT.md`** — 47 entries, newest first, verbatim. It had become
a log inside a file that says at the top it is not one, and every run paid to
read it before picking up a task.

Phases 0–3 are all complete and merged, tagged `phase-0` … `phase-3`, with
reports in `agent/reports/`. The three pillars are built end to end and the
demo flow runs as one automated sequence. Read `BUILT.md` when the question is
"does this already exist"; read it before proposing anything that sounds new.

Shipped since the phase plan ran out, in order: the cross-trail merge offer, the
embedding tier and its measurement, the model-download verb and the consent rule
behind it, the voice path with both gestures and its silence bounds, `done` and
the re-entry resume it forced, the Field's arrangement surviving a restart,
"This page made you ask" as the sidebar's second page-scoped section,
**forgetting** — the store's first delete of any kind, joined to Clear Recent
History and Forget About This Site — **forgetting reaching the live session**,
**private browsing being kept out of the database at all**, **the record
surviving a profile refresh, and surviving being unreadable**, and, this run,
**a page the command bar was asked for being recorded as a typed visit** — the
fork's first audit of what it writes into *Firefox's* data rather than what
Firefox does to its own.

## In progress

Nothing waits on a person. **Nothing is running — the harness is free.**

Run 50 took item 3 off the list — the new lens — and it paid on the first
question asked.

**The fork never told Places that it asked for a page.**
`nsINavHistoryService.markPageAsTyped` is how a piece of chrome declares that
it, and not a link on a page, wanted a URL; the method's own comment states the
default in one line — *"if this is not called visits will be marked as
TRANSITION_LINK"*. Firefox declares it from four surfaces (address bar, history
menu, history sidebar, places organiser); this fork replaced all four with
`FOSActionDispatcher` and declared it from none. Measured, not reasoned:
`moz_historyvisits.visit_type` was 1 where 2 was due.

It was never cosmetic. `SQLFunctions.cpp` scores a typed visit a tier above a
link visit on every visit, and `FOSPlacesFloor` ranks the command bar's fifth
tier by exactly that column — deliberately, on the grounds that re-sorting
would be inventing an opinion about a score it did not build. Which was right,
and is what hid this: **the dispatcher demoted the pages the user named and the
floor read the demotion back as though it were Places' opinion.** Neither
module could see the other.

Fixed with both halves, because half is worse than none. A *result page* is
marked typed like anything else and kept off the typed weight by the visit's
source, which `History.cpp` reads from a `triggeringSearchEngine` attribute
`Tabbrowser._updateTriggerMetadataForLoad` puts on the browser element from
`globalHistoryOptions`. Marking typed without passing the engine would lift
every result page above the pages found from it. Passing `undefined` for a
plain URL is equally load-bearing — the attribute lives on the browser element,
not on the load, so a URL after a search would otherwise be filed under the
last engine used.

**The private guard is not the docshell's, and looks redundant until it isn't.**
The typed mark is not a write and not private state: `MarkPageAsTyped` inserts
into one *global* in-memory map keyed by URL spec, `RECENT_EVENT_THRESHOLD` =
fifteen minutes. Mark from a private window, open the same page in an ordinary
one inside that window, and the profile gets a typed visit that private
browsing put there. Removing the guard fails
`test_a_private_window_does_not_mark_the_profile` with `2 == 1`.

Green: **949 FOS browser-chrome checks** (up from 904; the file adds 17), 322
node checks, xpcshell clean, 0 failures across the suite. **Three mutations,
all three caught** — the mark dropped (3 tasks fail), the private guard removed
(the leak appears), the search condition inverted (6 checks fail, including the
clearing one). Lint clean on every changed file.

`main` is at `phase-3`. `agent/dev` is pushed through this run's commits.

## Next task

1. **Why this build has no remote tabs.** Unchanged. Next step is
   `UrlbarProviderRemoteTabs.isActive` in a driven browser with
   `services.sync.username` set, not more reading.

2. **The rails still overlay the page**, and **the 17 timed-out urlbar files**,
   and **a region's height is a ratchet** (`FIELD.md` §6) — all unchanged, all
   belonging with the Field's restructure rather than piecemeal.

3. **`browser.userTypedValue`, the same lens' next probe.** The urlbar sets it
   before a load and SessionStore persists it, so a tab caught mid-load of a
   typed URL restores to what was asked for rather than to what was there. The
   fork never sets it. Real but small, and it tangles with trail re-entry
   restoring through `setTabState`, which is a different owner — so it wants
   its own look rather than a rider on something else. `IDEAS.md` run 50 has
   the two probes and the one thing that lens rejected (`moz_inputhistory`,
   deliberately not written, because provenance replaced the adaptive signal).

## Found this run, not yet chased

- **`node --test <directory>` does not work on this machine's node.** Every
  file in `tests/node/` carries a comment saying to run
  `node --test browser/components/fos/tests/node/`, and node 22 answers
  `MODULE_NOT_FOUND` for a bare directory. The working form is
  `node --test "browser/components/fos/tests/node/*.mjs"`. Not fixed, because
  it is eight files' worth of comment churn for a one-word difference; recorded
  here so the next run does not spend five minutes rediscovering it.

- **`./mach lint` with no `-l` crashes on this tree**, in mozlint's stylish
  formatter: `if err.hint and err.hint not in seen_hints` on a hint that is a
  dict. It is a formatter bug rather than a lint failure, and it hides real
  findings behind a traceback. `./mach lint -l eslint -f treeherder <paths>` is
  what to use; `-f summary` still crashes on the other linters' setup.

- **Testing a chrome module under `node --test` needs `ChromeUtils` stubbed
  before the module body runs**, which means a dynamic `import()` after setting
  `globalThis.ChromeUtils`, since static imports hoist.
  `tests/node/test_forgetpreview.mjs` is the first file in this tree to do it.
  The alternative — splitting the pure half of a small module into its own file
  for a test's convenience — was rejected as fragmenting a feature.

- **Recovery around the *migration* is unexercised.** Unchanged from run 47. A
  mutation moving the migration outside the recovered region survives; both
  corruption fixtures are rejected by `openConnection` before any migration
  statement runs. The guard stays. Do not delete it because a coverage tool
  calls it dead.

- **A deliberate surviving mutation, from run 46.** `detach` closes the open
  visit *before* leaving the `recording` set. Reversing the two lines survives
  and no honest test catches it: the ordering narrows a race window rather than
  establishing an invariant.

- **`BrowserTestUtils.openNewBrowserWindow({private: true})` never returns on
  this machine.** Unchanged; `browser_zzprivate.js` has the helper and the
  reason.

- **A clearing dialog cannot be opened standalone.** `Services.ww.openWindow`
  on `sanitize_v2.xhtml` gets a window with no `resizeDialog` — that method
  comes from the sub-dialog frame — so the shipped `init()` throws partway
  through and half the dialog is never set up. Go through `Sanitizer.showUI`
  and `gDialogBox` with
  `BrowserTestUtils.promiseAlertDialogOpen(null, url, { isSubDialog: true })`,
  which is what `browser_zzforgetpreview.js` does.

- **`spoken` on a sidebar query row is set and never read.** Unchanged from
  runs 43 to 47. Noted rather than chased.

## Background jobs

**Nothing is running.** `fossuite49b` was the last, and it finished — 904
browser-chrome checks, 0 failures.

`agent/mutate.sh` is new: apply one replacement, **assert it applied**, run a
command, restore. Run 44's rule about a mutation that silently matched nothing
reading exactly like one that survived is now enforced by the runner rather
than remembered. It also found that `browser/base/content/` files are
symlinked into `dist/bin`, so mutating a dialog needs no rebuild — only a new
file in `EXTRA_JS_MODULES` or a manifest change does.


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

The upstream tab tests were run to completion in run 42: **193 of 194 pass**.
The one failure, `browser_bfcache_exemption_about_pages.js`, crashes a content
process on `about:newtab` in a private window and **fails identically with both
FOS surface prefs off** — verified by re-running it that way. It joins the
x11/24.04 family this manifest already skips files for. `agent/tabtests-rest.txt`
is the file list without the three excluded ones.

## Blockers

None.

## Known staged state, not a defect

**Forgetting takes the record and not the tab.** A page open when its site is
forgotten keeps its document, its scroll position and anything typed into it;
the tab is left *unrecorded* — its browser loses its trail node, so nothing
further is written for what is still on screen — and navigating onward records
again. This is Firefox's own rule rather than the fork's invention
(`SessionStore.onPurgeDomainData`), and it is stated in `SCHEMA.md` §Forgetting
and asserted in `browser_zzforget.js`. Do not "improve" it into a per-site
never-record toggle: that is a fourth verb nobody asked for, and a private
window is the shipped answer to "record nothing".

**Reparenting past a forgotten node leaves an inference.** After forgetting the
middle of A → B → C the trail reads A → C, a navigation that never happened. The
edge does not say what was removed or that anything was, and nothing is
recoverable from it, but the branch keeps its shape. This is the accepted cost of
not deleting the subtree, which would mean forgetting one page forgets
everything found from it. A caller who needs the shape gone should forget the
range rather than the host, and `SCHEMA.md` §Forgetting says so.


**The two question sections can show the same list, and that is a small-N
artefact.** "This page made you ask" and "Questions asked" index one set of
facts along the page and along the enquiry, so they coincide exactly when every
question in the enquiry was asked from the page you are on — visible in a
scratch screenshot taken with a three-question fixture, all three asked from one
URL. In a real session questions come from several pages and the top section is
a strict, informative subset. Hiding one when they coincide was considered and
rejected: it is a rule that fires invisibly and would make the panel's shape
depend on a coincidence. Revisit only with a real session's questions in front
of you, and if it needs an answer the answer is probably to say on each of the
enquiry's rows which page it came from, not to hide a section.


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

**A negative test needs a fixture on which the wrong behaviour would visibly
succeed.** The guard deciding what counts as a corrupt database was first tested
with a *directory* in the database's place — and a directory makes `open` throw
whichever way the guard is written, because moving it aside fails too. The
mutation "always treat it as corrupt" survived, and the test had been passing
for the failure of something else entirely. The replacement is a healthy
database a migration cannot be applied to, where recovery *would* succeed if
attempted. Ask of every "and it correctly refuses to X" test: if X happened,
would this fixture let it complete?

**A failing `Sqlite.openConnection` deletes the hot journal on its way out.** It
attempts rollback-journal recovery before reporting the file unreadable, so by
the time a caller gets control there is usually no journal left to preserve.
Found by asserting the opposite and watching it fail. The consequence for
anything moving a database aside: the property to assert is that no journal is
left beside the *replacement*, not that the journal was carried off with the
original.

**`IOUtils.createUniqueFile` uniquifies before the last extension.**
`x.sqlite.corrupt` becomes `x.sqlite-1.corrupt`, not `x.sqlite.corrupt-1`. So
any sweep over files it created must match on prefix *and* suffix rather than
reconstruct the expected name. The shipped predicate does; the first version of
the test helper did not, and silently missed every second recovery — the
production code was right for a reason the test then demonstrated by getting it
wrong.


**A notification named for an ending is not proof that the thing has ended.**
`last-pb-context-exited` fires after the last private window closes, and if the
user has opened another one by then it lands on a live private session — the
test file's second private window was on screen when the topic fired for the
first. Check the condition; do not trust the topic. Consumers whose private
state is per-item (a download, a login) never notice this; a per-session store
does. The same reasoning applies to any `*-exited` or `*-finished` topic the
fork starts observing.

**`Sqlite.sys.mjs` cannot wrap a connection to a memory database**, because
`wrapStorageConnection` reads a name off `connection.databaseFile` and a memory
database has none. Two lines fix it. And **closing the wrapper does not close
the database**: a wrapped connection is deliberately treated as somebody else's
to shut down, so whoever opened the raw `mozIStorageAsyncConnection` has to
close it too, or it lives as long as the process does.

**`BrowserTestUtils.openNewBrowserWindow({private: true})` hangs on this
machine.** It waits for the private window's first tab to load, and that content
process dies on signal 11 — the same x11/24.04 family failure the tab manifest
already skips files for. Open the window with `OpenBrowserWindow({private:
true})` and wait for `browser-delayed-startup-finished`, registering the
observer *before* opening the window: delayed startup can finish before a caller
that opened first gets to subscribe. `browser_zzprivate.js` has the helper.

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



- **This box has no audio output device**, no `/dev/snd` and no sound cards, so
  `AudioContext` never leaves `suspended` and `destination.maxChannelCount` is
  0. Anything needing a running Web Audio graph cannot be tested here, and the
  failure looks like silence rather than like an error. `resume()` never settles
  on such a context, so do not await it. Autoplay is *not* the cause and was an
  hour's wrong suspect: `media.autoplay.default` is 0 in this profile and the
  context stays suspended with an active capture and user activation both set.

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

- 2026-08-19 — **A page's questions are shown whatever enquiry they belong to.**
  Excluding those the active context already lists emptied the section under one
  pinned enquiry — which is one tab, one trail, the ordinary case. The crossings'
  excluded row could never have been false; this one could, so the analogy that
  produced the rule does not reach it.
- 2026-08-19 — **Both page-scoped reads are keyed by URL, not by node.** A node
  is one visit, and a question asked during the visit you are in the middle of
  is one you still remember. SearchBar's 3.5-then-5.0 says the value is at
  resumption, and the rows worth having are months old and on other nodes for
  the same document.
- 2026-08-19 — **One row per question, at its first asking, with a landing node
  from whichever asking reached one.** The first asking is when the page
  provoked it — the same claim the crossings make about a trail's first arrival
  — but a question answered on the second try is answered, and a row showing the
  first attempt's dead end would say the opposite of what happened.
- 2026-08-19 — **The provoked section follows the crossings.** Both are about
  the page rather than the enquiry and belong together above everything that is
  not; a crossing is the rarer of the two, so it keeps the top of the panel.
- 2026-08-19 — **The fork can afford a bi-directional link because it owns both
  ends.** Two-way links lost on the open web to moderation, not to merit — no
  say in who links to you. A private local record has none of that, and the far
  end of this edge is the user's own question rather than a document, so there
  is nobody else to admit. `IDEAS.md` run 43.

- 2026-08-19 — **Only positions a human chose are persisted.** Seeding is
  deterministic, so an auto-placed card reproduces itself on the next start and
  a row for it carries no information; worse, the row would freeze a position
  the system is still entitled to revise. `moved_by_user_at IS NOT NULL` is the
  filter and the meaning, which is what the schema comment said in 001.
- 2026-08-19 — **A restored position grows its region rather than being
  refused.** Region height is a ratchet and is not itself persisted, so a
  position saved low in a grown region comes back out of bounds. §6's capacity
  ladder already ends in growth; refusing would silently destroy a position
  somebody chose, which §4 calls the one thing never to do.
- 2026-08-19 — **Pillar A announces, pillar C persists, and the dependency runs
  only that way.** The Field never learns what a database is: it emits where a
  card was put and the engine decides whether that is worth keeping. A window
  whose store fails to open still gets a Field, seeded as always — which is why
  the engine takes the field in `attach` and not the reverse.
- 2026-08-19 — **One placement per gesture, written on the drop.** Every pointer
  move commits to the model, so persisting per move would write a hundred rows
  for one drag and record every position the card passed through as chosen.
  Cards the drag *displaced* are not announced at all: they are unpinned, so
  §4 leaves them the system's to revise.
- 2026-08-19 — **The Done section moved to `agent/BUILT.md` verbatim.** It was
  588 lines of log in a file whose header says it is state and not a log, and
  every run read it before doing anything. Nothing was summarised away; STATE
  keeps an index and a pointer.
- 2026-08-19 — **`done` takes no mark, by design rather than by omission.** The
  only trail a user can address is the one they are on; nodes are what get
  marked. A verb offering a slot it can never be given is one the bar would
  advertise and then refuse. It grows an optional target on the day trails
  become markable, and not before.
- 2026-08-19 — **Finishing a trail writes nothing to its nodes.** `archived_at`
  on the trail already says it. Reusing `dismiss` across a trail's pages would
  have misreported what the user did — one statement about a thread, not nine
  about pages — and they would come back looking discarded rather than filed.
- 2026-08-19 — **`updated_at` does not move when a trail is archived, and does
  move when it is resumed.** Finishing work is a statement about it; going back
  to it is working on it again. Moving it on the way out would make every
  archived trail look freshly worked on to anything reading recency, which is
  the one thing archiving exists to correct.
- 2026-08-19 — **The undo for `done` is re-entry, not a verb.** Walking back
  into a trail is the plainest way of saying it was not finished after all. It
  costs no word out of `GRAMMAR.md` §4's table, cannot be forgotten the way a
  verb could, and it had to exist anyway: without it, re-entering a page from
  the context sidebar left the user extending a trail that would never be
  offered back.
- 2026-08-19 — **A slot freed by `done` is given to the most recently touched
  nested region**, the same metric `#collapseCandidates` uses read the other
  way, so no region is collapsed by one rule and promoted by another. An
  emptied nest gives its own slot back.
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
