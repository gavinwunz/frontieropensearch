#!/usr/bin/env bash
# One real voice turn: the key, the device, the recorder, the model, the bar.
#
# run29 answered "can this fork transcribe offline, and how fast". This answers
# the question after it: does the path the user actually presses work when
# nothing in it is a test double. The engine is the same one run29 measured,
# reached the way the browser reaches it rather than the way a measurement does.
#
# Two things it needs, for the same reasons run29 needed them: the weights come
# off the local hub, because mochitest kills the process on a non-local
# connection, and the microphone is Gecko's fake device, because this machine
# has none and a real one would make the run depend on a room.
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

echo "##### VOICE TURN $(date -u +%FT%TZ)"
FOS_VOICE_E2E=1 MOZ_MODELS_HUB="http://localhost:$port" \
  ./mach mochitest --keep-open=false --headless --force \
  --setpref=browser.ml.logLevel=Debug \
  browser/components/fos/tests/browser/browser_zzvoiceturn.js
echo "##### VOICE TURN EXIT $?"
