# STATE

The agent's working memory. Read at the start of every run, rewritten at the end.
Keep it short — this is state, not a log. History belongs in `JOURNAL.md`.

---

## Phase

**Phase 0 — Bootstrap** (not started)

## Done

- Nothing yet. This is the seed file; Run 1 has not happened.

## In progress

- Nothing.

## Next task

Clone the Firefox tree in full (not shallow — shallow clones break `mach`), then
run `./mach bootstrap` and choose "Firefox for Desktop".

## Background jobs

None running.

<!-- When a build is backgrounded, record it here so the next run can check it:
     - `./mach build` — PID 12345 — log `agent/logs/build-1755500000.log` — started 2026-08-18T04:10Z
-->

## Blockers

None.

## Failure counters

<!-- Task name → consecutive failures. At 3, stop retrying the same way, write the
     analysis below, and change approach or task. -->

None.

## Decisions taken

<!-- Short, dated, one line each. Anything a future run would otherwise
     re-litigate: rejected approaches, chosen libraries, structural calls. -->

- 2026-08-18 — Name fixed as Frontier OpenSearch. See `BRANDING.md`; do not
  revisit.
