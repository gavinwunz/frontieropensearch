#!/usr/bin/env bash
# Does a static embedding beat set intersection on a four-word lower-case query?
#
# The embedding pass has been the top of STATE's list since Phase 2 and its
# blocker went away two runs ago. This is the measurement that decides whether
# to build on it: `potion-retrieval-32M` at both published dimensions, against
# the Jaccard control the Context Engine already has for free, on a corpus of
# eight enquiries written the way queries are actually typed.
#
# Same two constraints as every other measurement here: the weights come off
# the local hub, because mochitest kills the process on a non-local connection,
# and the run is gated so it never joins the ordinary suite.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

models=/data/ml-models/onnx-models
weights=$models/mozilla/static-embeddings/v1.0.0/models/minishlab/potion-retrieval-32M
if [ ! -s "$weights/fp16.d512.npy.zst" ]; then
  echo "##### NO WEIGHTS at $weights — run agent/jobs/fetch-static-embeddings.sh"
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

echo "##### EMBED MEASURE $(date -u +%FT%TZ)"
FOS_MEASURE_EMBED=1 MOZ_MODELS_HUB="http://localhost:$port" \
  ./mach mochitest --keep-open=false --headless --force \
  browser/components/fos/tests/browser/browser_zzembedquality.js
echo "##### EMBED MEASURE EXIT $?"
