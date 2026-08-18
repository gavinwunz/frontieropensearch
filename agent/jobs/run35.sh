#!/usr/bin/env bash
# Run 35 — the picture of the arrival marking.
#
# The whole question is whether the accent reads at the overview scale, where a
# miniature is about ten pixels across. Nothing but a photograph answers that.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### SMOKE $(date -u +%FT%TZ)"
./agent/smoke.sh
echo "##### SMOKE EXIT $?"
