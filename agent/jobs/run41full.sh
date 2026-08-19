#!/usr/bin/env bash
# The whole FOS suite, after `done` and the re-entry resume it forced.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED"; exit 1; }

echo "##### NODE $(date -u +%FT%TZ)"
./browser/components/fos/tests/node/run.sh 2>&1 | tail -8

echo "##### XPCSHELL $(date -u +%FT%TZ)"
./mach test browser/components/fos/tests/unit/ 2>&1 | tail -12

echo "##### BROWSER (all fos) $(date -u +%FT%TZ)"
./mach test browser/components/fos/tests/browser/ 2>&1 | tail -30

echo "##### DONE $(date -u +%FT%TZ)"
