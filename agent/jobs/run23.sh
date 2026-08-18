#!/usr/bin/env bash
# Run 23's chain: verify the transform-scaled overview once run 22 lets go.
#
# Harness time is exclusive — one mochitest at a time, and `build faster`
# rewrites the omni.ja a running suite has mapped — so this waits for run 22's
# urlbar resume rather than racing it. Waiting inside one unit is the pattern
# STATE settled on: a second unit started now would collide.
#
#   1. wait      — until fos-job-run22 is no longer active.
#   2. build faster — this run's Field change, into dist.
#   3. fos suite — the acceptance gate, and browser_zzfieldperf.js in it is
#                  where the new resize numbers come from.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### WAIT FOR run22 $(date -u +%FT%TZ)"
while systemctl --user is-active --quiet fos-job-run22.service; do
  sleep 60
done
echo "##### run22 IS DONE $(date -u +%FT%TZ)"

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### FOS SUITE $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false browser/components/fos/tests/browser/
echo "##### FOS SUITE EXIT $?"
