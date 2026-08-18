#!/usr/bin/env bash
# Unit tests for the pieces of the frontend that touch no Gecko API — marks and
# the command grammar. These run without a build, in about a second.
#
# The node runner only scans a directory when its name matches its own test
# patterns, which "tests/node" does not, so the files are passed explicitly.
set -euo pipefail
cd "$(dirname "$0")"
exec node --test ./*.mjs
