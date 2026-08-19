#!/usr/bin/env bash
# `done`: the verb that finishes a trail, and the column that never had a writer.
#
# `archived_at` has been in the schema since 001-initial.sql and nothing in the
# product ever set it — `restorable()` filtered on a state no user could reach.
# This run gives it a writer and covers the three places the state has to be
# read: the tree, the Field's regions, and the resumption query.
#
# No weights and no hub: none of this needs a model.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

echo "##### BUILD FASTER $(date -u +%FT%TZ)"
./mach build faster || { echo "##### BUILD FAILED — stopping"; exit 1; }

echo "##### NODE $(date -u +%FT%TZ)"
./browser/components/fos/tests/node/run.sh 2>&1 | tail -12

echo "##### XPCSHELL store $(date -u +%FT%TZ)"
./mach test browser/components/fos/tests/unit/test_contextstore.js 2>&1 | tail -25

echo "##### BROWSER trailrail + field $(date -u +%FT%TZ)"
./mach test browser/components/fos/tests/browser/browser_trailrail.js \
            browser/components/fos/tests/browser/browser_field.js 2>&1 | tail -40

echo "##### DONE $(date -u +%FT%TZ)"
