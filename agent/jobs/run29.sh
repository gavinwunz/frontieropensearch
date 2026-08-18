#!/usr/bin/env bash
# The ASR measurement, attempt five — same question, one flag less wrong.
#
# run28 died in two seconds on `--hooks`, which is a `mach perftest` flag that
# `mach mochitest` rejects. head.js's own error message recommends it, which is
# how it got used; the message is written for the perftest harness.
#
# So start the tree's hub server directly (agent/jobs/local-hub.py imports the
# hook's handler rather than reimplementing it) and hand the port to the test
# through MOZ_MODELS_HUB, which is the variable head.js reads anyway. Verified
# by curl before queueing: query args stripped, ETag revalidation answering 304.
#
# Everything before this point still stands: run27 showed the native runtime
# loads offline and never consults Remote Settings. Only the weights were ever
# the problem, and they are on localhost now.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

models=/data/ml-models/onnx-models
if [ ! -d "$models" ]; then
  echo "##### NO MODELS at $models — run agent/jobs/fetch-whisper.sh"
  exit 1
fi

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

portfile=$(mktemp)
python3 agent/jobs/local-hub.py "$models" > "$portfile" 2>/dev/null &
hub=$!
trap 'kill $hub 2>/dev/null || true; rm -f "$portfile"' EXIT

for _ in $(seq 1 40); do [ -s "$portfile" ] && break; sleep 0.25; done
port=$(cat "$portfile")
if [ -z "$port" ]; then
  echo "##### HUB FAILED TO START"
  exit 1
fi
echo "##### LOCAL HUB on http://localhost:$port"

echo "##### ASR MEASUREMENT $(date -u +%FT%TZ)"
FOS_MEASURE_ASR=1 MOZ_MODELS_HUB="http://localhost:$port" \
  ./mach mochitest --keep-open=false --force \
  --setpref=browser.ml.logLevel=Debug \
  browser/components/fos/tests/browser/browser_zzvoicelatency.js
echo "##### ASR MEASUREMENT EXIT $?"
