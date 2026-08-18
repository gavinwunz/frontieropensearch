#!/usr/bin/env bash
# Mirror whisper-tiny q8 into a local hub tree for the ASR measurement.
#
# The measurement cannot fetch weights itself: mochitest aborts the process on
# any non-local connection ("FATAL ERROR: Non-local network connections are
# disabled"), which is what killed run27 *after* the native runtime had already
# loaded. The tree's supported answer is
# `--hooks toolkit/components/ml/tests/tools/hooks_local_hub.py`, which serves
# $MOZ_ML_LOCAL_DIR/onnx-models over localhost and exports MOZ_MODELS_HUB.
#
# The tree stays clean: this writes outside the repo, because a public fork does
# not carry 50MB of model weights in git.
set -euo pipefail

root=${MOZ_ML_LOCAL_DIR:-/data/ml-models}
dest="$root/onnx-models/onnx-community/whisper-tiny/main"
base="https://huggingface.co/onnx-community/whisper-tiny/resolve/main"

mkdir -p "$dest/onnx"

# dtype q8 resolves to the `_quantized` artifacts in Transformers.js.
files=(
  config.json
  generation_config.json
  preprocessor_config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  added_tokens.json
  normalizer.json
  vocab.json
  onnx/encoder_model_quantized.onnx
  onnx/decoder_model_merged_quantized.onnx
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
du -sh "$root/onnx-models"
find "$dest" -type f -printf '%10s  %P\n' | sort -k2
