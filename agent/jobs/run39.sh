#!/usr/bin/env bash
# How do you score two *contexts* against each other, and where is the floor?
#
# The `related` tier thresholds one query against one title, and run 37
# measured that. Offering to merge two contexts is a different question: a
# context is a set of queries, so the score is an aggregate over many pairs.
# Run 37's lesson was that a threshold is only measured if you can say what it
# was measured over, so this measures the aggregate over aggregates rather than
# reusing 0.201 and hoping it transfers.
#
# Same file and same two constraints as run 36 — the weights come off the local
# hub, because mochitest kills the process on a non-local connection, and the
# run is gated so it never joins the ordinary suite.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

models=/data/ml-models/onnx-models
weights=$models/mozilla/static-embeddings/v1.0.0/models/minishlab/potion-retrieval-32M
if [ ! -s "$weights/fp16.d256.npy.zst" ]; then
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

echo "##### MERGE MEASURE $(date -u +%FT%TZ)"
FOS_MEASURE_EMBED=1 MOZ_MODELS_HUB="http://localhost:$port" \
  ./mach mochitest --keep-open=false --headless --force \
  browser/components/fos/tests/browser/browser_zzembedquality.js
echo "##### MERGE MEASURE EXIT $?"
