#!/usr/bin/env bash
# The scripted end-to-end smoke run.
#
# Drives the demo flow — search, branch three ways, zoom out to the Field,
# switch context, export a context pack — in a real browser and leaves the
# screenshots and the exported brief in agent/reports/.
#
# The flow itself is browser/components/fos/tests/browser/browser_zdemoflow.js
# and is an ordinary browser-chrome test, so it runs in the suite too. What
# this script adds is the artefacts: the test photographs each stage only when
# FOS_SHOTS names a directory, so a normal `mach test` writes nothing and this
# run writes everything.
#
# Passing the directory in rather than deriving it is deliberate. A test cannot
# know where the source tree is, and a path baked into a public repository is a
# personal path published.
#
#   ./agent/smoke.sh              # writes to agent/reports/
#   ./agent/smoke.sh /tmp/shots   # writes somewhere else
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shots="${1:-$root/agent/reports}"
mkdir -p "$shots"

echo "smoke: writing artefacts to $shots"

cd "$root"
# `mach mochitest`, not `mach test`: only the mochitest command takes
# --setenv, and the flow needs the directory in the browser's own environment.
./mach mochitest \
  --setenv "FOS_SHOTS=$shots" \
  browser/components/fos/tests/browser/browser_zdemoflow.js

echo
echo "smoke: artefacts"
ls -l "$shots"/demo-* 
