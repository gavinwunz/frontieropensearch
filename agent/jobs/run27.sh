#!/usr/bin/env bash
# The ASR measurement's third attempt, and the first one that asks the right
# question.
#
# Attempts one (run25) and two (run26) both failed, and the three-strikes rule
# says the third must not be the same approach. It is not. run25 died on
# `Cu.now()`; run26 died on "Unable to get the ML engine from Remote Settings"
# and was read as "this fork has no offline ML at all". That reading was wrong.
#
# The test passed `device` and never passed `backend`. `MLEngineChild` reads
# `opts.backend || BACKENDS.onnx`, so an unnamed backend is the *wasm* backend,
# whose runtime is a Remote Settings attachment with no packaged dump — hence
# the identical instant failure on both arms. The device axis never mattered.
#
# `onnx-native` is the other ONNX backend: it runs on `libonnxruntime.so`,
# which `./mach bootstrap` pulls as a build toolchain and which is already in
# `dist/bin`, and `WASM_BACKENDS` excludes it so Remote Settings is never
# consulted. That arm is measured first and is the one the fork can ship.
#
# `--force` because run26's runner said "Skipping test file installation (up to
# date)" and the whole point of this run is that the file changed.
#
# logLevel=Debug so `ONNXPipeline`'s "Using backend ..." line lands in the log:
# if the native arm is unavailable, the reason should be readable rather than
# inferred.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### ASR MEASUREMENT $(date -u +%FT%TZ)"
FOS_MEASURE_ASR=1 ./mach mochitest --keep-open=false --force \
  --setpref=browser.ml.logLevel=Debug \
  browser/components/fos/tests/browser/browser_zzvoicelatency.js
echo "##### ASR MEASUREMENT EXIT $?"
