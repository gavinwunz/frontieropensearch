#!/usr/bin/env bash
# Run 22's chain, in the one order the harness allows.
#
# Only one mochitest can run at a time — it binds 8888 — and `build faster`
# rewrites the omni.ja that every running Firefox has mapped, so it cannot
# overlap a suite either. That makes harness time exclusive, and it is why the
# whole-directory urlbar run was stopped at 115 files rather than left to
# finish: it had already produced the four failures worth chasing, it holds the
# harness for another two hours, and `--start-at` makes resuming it cost
# nothing. See STATE.
#
#   1. build faster   — this run's Field change, into dist.
#   2. triage         — are the four urlbar failures this fork's doing?
#   3. fos suite      — the acceptance gate for the change in step 1.
#   4. urlbar, resumed from where the stop landed.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### TRIAGE $(date -u +%FT%TZ)"
./agent/jobs/urlbar-triage.sh

echo "##### FOS SUITE $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false browser/components/fos/tests/browser/
echo "##### FOS SUITE EXIT $?"

echo "##### URLBAR RESUMED $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false \
  --start-at browser/components/urlbar/tests/browser-telemetry/browser_handoff.js \
  browser/components/urlbar/tests/
echo "##### URLBAR EXIT $?"
