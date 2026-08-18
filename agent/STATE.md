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

- First full `./mach build`. See background jobs.

## Next task

1. Check the build log. If it failed, fix and restart; if it succeeded, run
   `./mach run` and confirm Phase 0's acceptance criterion — a browser launches.
2. Then Phase 1: the remaining user-visible "Firefox" strings. The branding
   directory and app constants are already done, so what is left is the l10n
   override path and the about dialog. Do not mass-sed the tree.

## Background jobs

- `./mach build` — PID 1321471 — log `agent/logs/build-1787051116.log` —
  started 2026-08-18T11:05Z. Expect 1–2 hours on 8 cores. Compiling normally as
  of 11:25Z, no errors. Note the build detects an agent and limits the log to
  warnings and errors, so an uneventful log is the healthy case.
- Chunked push of upstream history to `origin/agent/dev` — log
  `agent/logs/push-1787051326.log`. Pushes 40k commits at a time; a single 5G
  push would exceed GitHub's per-push limit. Ends with the line `PUSH COMPLETE`.

## Blockers

None.

## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

None.

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
