#!/usr/bin/env bash
# The related tier in a real browser, with real weights.
#
# run36 measured whether a static embedding is worth shipping. This drives the
# thing that was shipped because of it: a page sharing no word with the query,
# offered by the command bar because the model put it there.
#
# Same harness as every other model-backed run here — the weights come off the
# local hub, because mochitest kills the process on a non-local connection.
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

echo "##### RELATED TIER $(date -u +%FT%TZ)"
MOZ_MODELS_HUB="http://localhost:$port" \
  ./mach mochitest --keep-open=false --headless --force \
  browser/components/fos/tests/browser/browser_zzrelated.js
echo "##### RELATED TIER EXIT $?"
