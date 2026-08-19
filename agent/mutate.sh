#!/bin/bash
# Apply one replacement, assert it applied, run a command, restore.
#
# Run 44's rule: a mutation that did not apply reads exactly like a mutation
# that survived, and manufactures a coverage gap that is not there. So the
# replacement is asserted before anything is run.
#
#   ./agent/mutate.sh <file> <old> <new> <command...>
set -o pipefail
cd /data/frontieropensearch
FILE="$1"; OLD="$2"; NEW="$3"; shift 3
python3 - "$FILE" "$OLD" "$NEW" <<'PY' || exit 2
import sys, io
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding="utf-8").read()
if s.count(old) != 1:
    print(f"MUTATION DID NOT APPLY: {s.count(old)} occurrences", file=sys.stderr)
    sys.exit(1)
io.open(path + ".orig", "w", encoding="utf-8").write(s)
io.open(path, "w", encoding="utf-8").write(s.replace(old, new))
PY
"$@" > /tmp/mutation.log 2>&1
RC=$?
mv "$FILE.orig" "$FILE"
if [ $RC -eq 0 ]; then echo "SURVIVED"; else echo "CAUGHT"; fi
