#!/usr/bin/env bash
# Run 25's chain: the ASR measurement, once run 23 lets go of the harness.
#
# This is item 1 in STATE's ordered list and it has been blocked for two runs
# purely by harness contention — run 22's urlbar resume holds it until roughly
# 23:54Z, and run 23 waits behind that for the acceptance gate on run 23's two
# changes. Neither needs a person, so the measurement belongs in the same
# queue rather than in the next run's foreground.
#
# Waiting on run23 is what matters, not run22: `browser_zzvoicelatency.js` was
# written after run 22's `build faster` ran, so run 23's is the first build that
# copies it into _tests.
#
#   1. wait  — until fos-job-run23 is no longer active.
#   2. measure — whisper-tiny q8, both backends, against run 23's ~1s natural /
#                2s tolerable budget. Downloads ~75MB on its first run.
#
# Read the answer with `grep '##### ASR' agent/logs/run25.current`. The GPU
# line may well be absent — `checkGPUSupport()` can refuse on this machine —
# and that is a result, not a failure: it means the CPU numbers are the
# shipping numbers and the shell defaults to CPU.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### WAIT FOR run23 $(date -u +%FT%TZ)"
while systemctl --user is-active --quiet fos-job-run23.service; do
  sleep 60
done
echo "##### run23 IS DONE $(date -u +%FT%TZ)"

echo "##### ASR MEASUREMENT $(date -u +%FT%TZ)"
FOS_MEASURE_ASR=1 ./mach mochitest --keep-open=false \
  browser/components/fos/tests/browser/browser_zzvoicelatency.js
echo "##### ASR MEASUREMENT EXIT $?"
