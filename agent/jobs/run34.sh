#!/usr/bin/env bash
# Run 34 — the Field says which card arrived, and a picture of it.
#
# The dot on the bar answers "has anything arrived"; the Field is where it
# went, and until now it said nothing about which card that was. The shot is
# taken because the whole question is whether the accent reads at the overview
# scale, where a miniature is about ten pixels across.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### FOS SUITE $(date -u +%FT%TZ)"
./mach mochitest --keep-open=false --force browser/components/fos/tests/browser/
echo "##### FOS SUITE EXIT $?"

echo "##### SMOKE $(date -u +%FT%TZ)"
./agent/smoke.sh
echo "##### SMOKE EXIT $?"
