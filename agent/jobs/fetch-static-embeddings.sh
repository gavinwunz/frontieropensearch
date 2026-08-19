#!/usr/bin/env bash
# Mirror potion-retrieval-32M into the local hub tree for the embedding measurement.
#
# Same constraint as fetch-whisper.sh: mochitest aborts the process on any
# non-local connection, so the weights have to be on disk and served from
# localhost before the measurement starts.
#
# Two dimensions, deliberately. `EmbeddingsGenerator` prefers 512 and the
# backend also publishes 256; the fetch is 60MB against 30MB, and whether the
# smaller one costs anything on short queries is the question the measurement
# is there to answer. A one-time download is a thing this fork asks the user
# for, so its size is a design decision and not a default.
set -euo pipefail

root=${MOZ_ML_LOCAL_DIR:-/data/ml-models}
sub=models/minishlab/potion-retrieval-32M
dest="$root/onnx-models/mozilla/static-embeddings/v1.0.0/$sub"
base="https://model-hub.mozilla.org/mozilla/static-embeddings/v1.0.0/$sub"

mkdir -p "$dest"

# The backend appends .zst to every file when compression is on, which is the
# option EmbeddingsGenerator passes.
files=(
  tokenizer.json.zst
  fp16.d256.npy.zst
  fp16.d512.npy.zst
)

for f in "${files[@]}"; do
  out="$dest/$f"
  if [ -s "$out" ]; then
    echo "have  $f"
    continue
  fi
  echo "fetch $f"
  curl -fsSL --retry 3 -o "$out" "$base/$f"
done

echo "--- staged ---"
find "$dest" -type f -printf '%10s  %P\n' | sort -k2
