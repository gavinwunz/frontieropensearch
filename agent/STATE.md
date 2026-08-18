# STATE

The agent's working memory. Read at the start of every run, rewritten at the end.
Keep it short — this is state, not a log. History belongs in `JOURNAL.md`.

---

## Phase

**Phase 0 — Bootstrap** (in progress; first full build running)

## Done

- Firefox upstream added as remote `upstream` (push disabled) and fetched in
  full — 12.6M objects, 5.1G. Merged into `agent/dev` with
  `--allow-unrelated-histories`. Tree is 473k files and `./mach` works.
- Merge conflicts resolved: `.gitignore` is the union of both, `README.md` and
  `CLAUDE.md` are the fork's. Upstream's `CLAUDE.md` was only a pointer to
  `AGENTS.md`, which survives untouched.
- `./mach bootstrap` complete. Toolchains in `/data/.mozbuild`.
- `context-engine/SCHEMA.md` written — tables, migration policy, and the three
  design decisions that are easy to get wrong.
- `browser/branding/frontieropensearch/` created from `unofficial`: brand
  strings, prefs with update/telemetry off, and `generate-mark.py`, which is the
  single source of truth for the mark — it emits the SVG and every PNG size.
- `./mach configure` passes. Verified in `config.status`:
  `MOZ_APP_DISPLAYNAME='Frontier OpenSearch'`, `MOZ_APP_NAME='frontieropensearch'`,
  `MOZ_APP_BASENAME='FrontierOpenSearch'`, `MOZ_APP_VENDOR='Frontier'`,
  `MOZ_APP_PROFILE='frontieropensearch'`,
  `MOZ_BRANDING_DIRECTORY='browser/branding/frontieropensearch'`.

## In progress

- First full `./mach build`, restarted under the rewritten `bg.sh`. This is the
  third attempt; the two before it were killed by the cgroup bug below, not by
  any build fault, and the objdir plus sccache carry over so nothing restarts
  from zero.
- Chunked push of history to `origin/agent/dev`, resumed at 476k of 990k.

## Next task

1. Run `./agent/bg-status.sh` first. It reports each job as finished, failed
   with a code, still running, or killed without a marker.
2. If the build succeeded, run `./mach run` and confirm Phase 0's acceptance
   criterion — a browser launches. That closes Phase 0.
3. Then Phase 1: the remaining user-visible "Firefox" strings. The branding
   directory and app constants are already done, so what is left is the l10n
   override path and the about dialog. Do not mass-sed the tree.
4. Do not edit anything under `browser/` or `toolkit/` while a full build is in
   flight — research and the `agent/`, `context-engine/` and `design/` docs are
   the safe work. Build inputs have not been touched since the build started.
5. `design/GRAMMAR.md` is ready to implement whenever Phase 2 opens. Marks and
   the parser are pure frontend logic with no dependency on the ASR spike, so
   they are the right first thing to build in 2 and can be tested by keyboard
   alone.

## Background jobs

Started with `./agent/bg.sh <name> <cmd>`; check with `./agent/bg-status.sh`.
Each runs as its own transient systemd unit `fos-job-<name>.service`, in
`app.slice` beside `fos.service` rather than inside it. Verified this run: a
restart cannot reach them. `agent/logs/<name>.current` symlinks the live log.

- `./mach build` — log `agent/logs/build-1787052148.log`, unit
  `fos-job-build.service` — started 2026-08-18T11:22Z. Expect 1–2 hours on 8
  cores. The build detects an agent and limits output to warnings and errors,
  so a quiet log is the healthy case — judge it by the `=== EXIT n ===` marker,
  not by the tail.
- `./agent/push-chunked.sh` — log `agent/logs/push-1787052149.log`, unit
  `fos-job-push.service`. Pushes 40k commits at a time because a single 5G push
  exceeds GitHub's limit. Resumable: it reads where origin is and continues.
  Ends with `PUSH COMPLETE`. At 516k of 990k commits as of 11:46Z.

## Blockers

None.

## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

Full build — 2 consecutive losses, both from the cgroup bug, neither from a
build fault. Not counted as strikes against the build itself, but the *reason*
was: two runs in a row diagnosed "job died" and fixed the wrong layer. The third
attempt is running under a fix that was verified by inspecting the cgroup rather
than by reasoning about it, which is the actual lesson. If this build dies too,
do not patch the launcher a third time — check `journalctl --user -u
fos-job-build` for what killed it before changing anything.

## Decisions taken

- 2026-08-18 — Fork-owned design specs live in `design/`. `docs/` at the repo
  root is upstream Firefox's and is not ours to fill. `design/GRAMMAR.md` is the
  command bar and marks spec; `context-engine/SCHEMA.md` remains the data layer.
- 2026-08-18 — Every addressable object carries a **mark**: one letter, shown,
  spoken as its Talon-alphabet word. Typing `c` and saying "cap" resolve through
  one path, which is how "no separate accessibility mode" is met. Marks are
  sticky for an object's lifetime — the point is that a name can be learned,
  which is exactly what positional numbering in macOS Voice Control gives up.
- 2026-08-18 — The command bar treats any input not starting with a known action
  word as a search. No mode switch, ever, in either modality.
- 2026-08-18 — The captured navigation tree and a **Trail** are different things.
  Capture is automatic and total; a Trail is a named, curated selection promoted
  out of it. This is what distinguishes pillar B from Nyxt's history tree, which
  already ships.
- 2026-08-18 — Name fixed as Frontier OpenSearch. See `BRANDING.md`; do not
  revisit.
- 2026-08-18 — Upstream is a git remote, not a vendored copy. The fork keeps
  full Firefox history so it can rebase onto upstream later. `upstream` has its
  push URL set to `no_push`.
- 2026-08-18 — All build state lives on `/data`. The root filesystem has under
  5G free, so `~/.mozbuild` is a symlink to `/data/.mozbuild`. Source
  `agent/env.sh` before any mach command.
- 2026-08-18 — `mozconfig` is checked in and portable — no absolute paths. It is
  un-ignored explicitly in `.gitignore`, which otherwise excludes `/mozconfig*`.
- 2026-08-18 — `MOZ_APP_VENDOR` and `MOZ_APP_PROFILE` are `imply_option()`s in
  `browser/moz.configure` and cannot be set from a mozconfig, so they are patched
  at source. That two-line diff is the only tree edit outside the branding dir.
- 2026-08-18 — `MOZ_APP_ID` left at Firefox's GUID for now. Changing it affects
  extension compatibility and it is not user-visible. Revisit in Phase 1 only if
  profile collision proves to be a real problem.
- 2026-08-18 — The Context Engine will use the in-tree ML runtime
  (`toolkit/components/ml`) for embeddings and clustering. Nothing new gets
  vendored. See `IDEAS.md`.
- 2026-08-18 — The hands-free path is voice via a local Whisper model on that
  same runtime, push-to-talk. Gecko's Web Speech API is cloud-only and is
  therefore unusable here. See `IDEAS.md`.
- 2026-08-18 — Long jobs start via `agent/bg.sh`, which launches them with
  `systemd-run --user` as their own unit. The agent is a `Type=oneshot` systemd
  user service, so when its process returns systemd deactivates `fos.service`
  and `KillMode=control-group` SIGTERMs everything left in that cgroup. Neither
  `nohup` nor `setsid` escapes this — a new session is still the same cgroup,
  and run 2 mistook a verified new session for proof of safety. Only a separate
  cgroup survives. The exit marker in the log stays: it is what distinguishes a
  killed job from a finished one.
- 2026-08-18 — sccache enabled, cache on `/data`. Turned on while the build was
  only six minutes in, so the restart cost almost nothing and every later
  clobber is cheap.
- 2026-08-18 — Voice input is no longer treated as settled. `text-to-speech` is
  a supported task on the in-tree engine but `automatic-speech-recognition` is
  not listed, so a small capture-to-transcript spike gates the voice work. See
  `IDEAS.md`.
