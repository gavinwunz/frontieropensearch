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

- First full `./mach build`, restarted under `bg.sh` with sccache enabled.
- Chunked push of history to `origin/agent/dev`, resumed from where run 1 died.

## Next task

1. Run `./agent/bg-status.sh` first. It reports each job as finished with an
   exit code, still running, or killed without a marker.
2. If the build succeeded, run `./mach run` and confirm Phase 0's acceptance
   criterion — a browser launches. That closes Phase 0.
3. Then Phase 1: the remaining user-visible "Firefox" strings. The branding
   directory and app constants are already done, so what is left is the l10n
   override path and the about dialog. Do not mass-sed the tree.
4. Do not edit anything under `browser/` or `toolkit/` while a full build is in
   flight — research and the `agent/` and `context-engine/` docs are the safe
   work. Both were edited freely this run; build inputs were not.

## Background jobs

Started with `./agent/bg.sh <name> <cmd>`; check with `./agent/bg-status.sh`.
Both survive an agent restart, which the run-1 versions did not.

- `./mach build` — log `agent/logs/build-1787051660.log`, pid in
  `agent/logs/build.pid` — started 2026-08-18T11:14Z. Expect 1–2 hours on 8
  cores. The build detects an agent and limits output to warnings and errors,
  so a quiet log is the healthy case — judge it by the `=== EXIT n ===` marker,
  not by the tail.
- `./agent/push-chunked.sh` — log `agent/logs/push-1787051713.log`. Pushes 40k
  commits at a time because a single 5G push exceeds GitHub's limit. Resumable:
  it reads where origin is and continues. Ends with `PUSH COMPLETE`. At 317k of
  990k commits as of 11:31Z.

## Blockers

None.

## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

None. Run 1's build and push both died, but from being killed rather than from
any fault of their own, so nothing is counted against them.

## Decisions taken

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
- 2026-08-18 — Long jobs start via `agent/bg.sh`, never a bare `nohup ... &`.
  The supervisor kills the agent's process group on restart, which silently
  took run 1's build and push with it. `setsid` detaches them; an explicit exit
  marker in the log distinguishes a killed job from a finished one.
- 2026-08-18 — sccache enabled, cache on `/data`. Turned on while the build was
  only six minutes in, so the restart cost almost nothing and every later
  clobber is cheap.
- 2026-08-18 — Voice input is no longer treated as settled. `text-to-speech` is
  a supported task on the in-tree engine but `automatic-speech-recognition` is
  not listed, so a small capture-to-transcript spike gates the voice work. See
  `IDEAS.md`.
