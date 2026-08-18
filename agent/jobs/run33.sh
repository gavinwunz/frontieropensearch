#!/usr/bin/env bash
# Run 33 — the three defects the run-32 pictures found.
#
# 1. A background arrival moved the active trail, and with it the marks, the
#    context sidebar, what `name` names and the command bar's tiers.
# 2. The rail and the context sidebar covered the browser's own toolbar.
# 3. The screenshot test closed the sidebar with a verb that closes nothing,
#    so the picture of "an ordinary window doing nothing" had a sidebar and a
#    stale notice on it.
#
# The suite first, then the smoke run, so the pictures are retaken over the
# fixed build and the sidebar shot can be compared against run 32's.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### FOS SUITE $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false --force browser/components/fos/tests/browser/
echo "##### FOS SUITE EXIT $?"

echo "##### SMOKE $(date -u +%FT%TZ)"
./agent/smoke.sh
echo "##### SMOKE EXIT $?"
