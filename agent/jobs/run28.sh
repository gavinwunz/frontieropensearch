#!/usr/bin/env bash
# The ASR measurement, attempt four — and the runtime question is already
# answered, so this one is only about the numbers.
#
# run27 settled the thing that was actually blocking the voice pillar: with
# `backend: "onnx-native"` the engine loaded from the packaged
# `libonnxruntime.so`, logged "Using backend onnx-native", initialised the
# pipeline and went straight to fetching weights. Remote Settings was never
# consulted. The offline runtime works.
#
# It then died on the *weights*: mochitest kills the process on any non-local
# connection, so `model-hub.mozilla.org` is fatal by construction and no amount
# of retrying the same shape would ever have worked. Hence a different approach
# rather than a fourth identical one: serve the model from localhost using the
# tree's own hook, which exports MOZ_MODELS_HUB for the test to read.
#
# agent/jobs/fetch-whisper.sh has already mirrored whisper-tiny q8 into
# /data/ml-models/onnx-models, outside the repo.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

export MOZ_ML_LOCAL_DIR=/data/ml-models

if [ ! -d "$MOZ_ML_LOCAL_DIR/onnx-models" ]; then
  echo "##### NO MODELS at $MOZ_ML_LOCAL_DIR/onnx-models — run agent/jobs/fetch-whisper.sh"
  exit 1
fi

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### ASR MEASUREMENT $(date -u +%FT%TZ)"
FOS_MEASURE_ASR=1 ./mach mochitest --keep-open=false --force \
  --hooks toolkit/components/ml/tests/tools/hooks_local_hub.py \
  --setpref=browser.ml.logLevel=Debug \
  browser/components/fos/tests/browser/browser_zzvoicelatency.js
echo "##### ASR MEASUREMENT EXIT $?"
