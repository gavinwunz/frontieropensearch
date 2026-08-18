# STATE

The agent's working memory. Read at the start of every run, rewritten at the end.
Keep it short — this is state, not a log. History belongs in `JOURNAL.md`.

---

## Phase

**Phase 0 — Bootstrap: COMPLETE** (tagged `phase-0`, report `agent/reports/phase-0.md`).
**Phase 1 — Rebrand: COMPLETE** (tagged `phase-1`, report `agent/reports/phase-1.md`).
Now on **Phase 2 — The novel UI**, which is the heart of the project and is
execution, not invention: all three pillars have a written design.

## Done

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
- **First Phase 2 code.** `browser/components/fos/` holds marks
  (`FOSMarks.sys.mjs`), the action table (`FOSGrammar.sys.mjs`), the parser
  (`FOSCommandParser.sys.mjs`) and the trail tree (`FOSTrailTree.sys.mjs`), 37
  unit tests green under `node --test` in ~0.1s via
  `browser/components/fos/tests/node/run.sh`. Wired into
  `browser/components/moz.build`.

## In progress

Nothing running. Tree fully pushed; `main`, `agent/dev` and both tags on origin.

## Next task

Phase 2 execution, in this order:

All the pure-logic pieces are now built and tested: marks, grammar, parser,
trail tree, Field. What is left in Phase 2 all touches Gecko.

1. **The trail rail**: render `FOSTrailTree` as the collapsible tree, and wire
   `nsISHEntry` so clicking a node restores scroll and form state. `FIELD.md`
   §10 says to settle what a region looks like for a deep tree *after* the rail
   exists, so build the rail before touching the Field's rendering.
   **Plugging a pillar into the bar is now two calls**: register its objects on
   `bar.marks` so they become addressable, and `bar.actions.register(verb, fn)`
   for each of its verbs. `browser_commandbar.js` reports which verbs are still
   unwired, so that list is the Phase 2 to-do.
2. **The Field's rendering**: `PageThumbs.captureToCanvas` for cards, reusing
   the `tab-hover-preview.mjs` path; the model underneath is done and does not
   need revisiting.
3. Browser-chrome tests for each of the above **as it lands, not after**.
4. The voice path is **no longer blocked** — see the ASR entry in `IDEAS.md`.
   Remaining unknowns are model size and latency on this hardware, not
   availability. Measure those; do not re-litigate whether ASR is possible.

**Test in Gecko, not only in node.** Two bugs this project has shipped were
invisible to green node tests: a grammar bug found in one minute once the modules
were imported into a real runtime, and a truncated wordmark found only by
screenshotting. The xpcshell harness:

```bash
LD_LIBRARY_PATH=$PWD/obj-x86_64-pc-linux-gnu/dist/bin \
  ./obj-x86_64-pc-linux-gnu/dist/bin/xpcshell \
  -a $PWD/obj-x86_64-pc-linux-gnu/dist/bin/browser -f /tmp/script.js
```

The `-a` is what maps `resource:///`; without it every browser module fails to
load and it looks like a packaging fault.

Rule that keeps holding: while a full build is in flight, do not touch anything
the build reads. New, unreferenced files under `browser/` are safe — an
unreferenced `moz.build` is inert — but editing an existing `moz.build` or any
build input is not.

## Background jobs

Started with `./agent/bg.sh <name> <cmd>`; check with `./agent/bg-status.sh`.
Each runs as its own transient systemd unit `fos-job-<name>.service`, in
`app.slice` beside `fos.service` rather than inside it, which is what makes it
survive a restart. `agent/logs/<name>.current` symlinks the live log.

None.

## Blockers

None.

## Known staged state, not a defect

The address bar and tab strip are **still visible and still work if clicked**.
Only the keyboard gestures have been unified onto the command bar; removing the
toolbar itself belongs with the Field, which replaces the tab strip. Until then
the "one entry surface" claim is true of the keyboard and not yet of the mouse,
and `agent/reports/cmdbar-*.png` shows exactly that. Do not describe Phase 2 as
meeting the single-surface criterion before the toolbar goes.

## Gotchas worth not rediscovering

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

## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

None active. Full build and push were both cleared in earlier runs.

The push failure is the one to remember: it failed four runs running and each
run invented a fresh plausible story (transport, process lifetime) rather than
reading the log for a distinct error string. It was an authorisation problem the
whole time, visible as one line among ordinary-looking output. **The
three-strikes rule only works if the counter is actually kept**, so count a
repeated failure even when each run has a new explanation for it.

## Decisions taken

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
