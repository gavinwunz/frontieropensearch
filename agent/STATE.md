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

1. **The Field's card and region model** (`design/FIELD.md`) — the last
   pure-logic piece, so it can be built and tested the cheap way first. A region
   is a trail, so it builds on `FOSTrailTree`.
2. `PageThumbs` capture for cards; `nsISHEntry` for restoring a node's scroll and
   form state; the command bar UI over the existing parser.
3. Turn `FIELD.md` §9's four acceptance properties into browser-chrome tests
   **as each piece lands, not after**.
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

## Gotchas worth not rediscovering

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
