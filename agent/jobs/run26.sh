#!/usr/bin/env bash
# Run 25's second attempt at the ASR measurement.
#
# The first attempt (run25) failed on its first timed line — `Cu.now is not a
# function` — which is run 24's test having been written and never run, and is
# the "test in Gecko, not only in node" gotcha collecting another example. The
# tree's timer for chrome code is `ChromeUtils.now()`.
#
# `build faster` comes first because the mochitest runner reported "Skipping
# test file installation (up to date)": the fixed file has to reach _tests
# before the run that reads it.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### ASR MEASUREMENT $(date -u +%FT%TZ)"
FOS_MEASURE_ASR=1 ./mach mochitest --keep-open=false \
  browser/components/fos/tests/browser/browser_zzvoicelatency.js
echo "##### ASR MEASUREMENT EXIT $?"
