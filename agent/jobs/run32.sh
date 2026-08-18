#!/usr/bin/env bash
# Run 32 — the two changes run 23 made that still owe eyes rather than
# assertions, plus the numbers that go with them.
#
# 1. The unseen mark. browser_zzscreenshots.js gained a `shot-unseen` step
#    eight runs ago and no run since has actually looked at the picture. An
#    8px accent dot beside the page actions either reads at a glance or
#    shouts, and no assertion in the suite can tell the difference.
# 2. The resize numbers. browser_zzfieldperf.js prints
#    crowded-overview-resizing-frame against closed-field-resizing-frame —
#    the pair that was ~31ms apart before the coalescing — and
#    resize-burst-of-10, which should be flat.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### SMOKE $(date -u +%FT%TZ)"
./agent/smoke.sh
echo "##### SMOKE EXIT $?"

echo "##### FIELD PERF $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false --force \
  browser/components/fos/tests/browser/browser_zzfieldperf.js
echo "##### FIELD PERF EXIT $?"
