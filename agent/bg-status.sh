#!/usr/bin/env bash
# Report on every job started by bg.sh. Run this first thing each run.
#
# Three states, and the distinction that matters is the third: a job with no
# exit marker and no live unit was killed rather than having failed, which
# means the log's last line is not a symptom and there is no bug to chase.
set -uo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

shopt -s nullglob
found=0
for cur in "$root"/agent/logs/*.current; do
  found=1
  name=$(basename "$cur" .current)
  log="$root/agent/logs/$(readlink "$cur")"
  unit="fos-job-$name.service"
  marker=$(tail -1 "$log" 2>/dev/null | grep -o '=== EXIT [0-9]* ===' || true)

  if [ -n "$marker" ]; then
    code=$(echo "$marker" | tr -dc '0-9')
    [ "$code" = "0" ] && state="finished OK" || state="FAILED exit $code"
  elif systemctl --user is-active --quiet "$unit" 2>/dev/null; then
    since=$(systemctl --user show "$unit" -p ActiveEnterTimestamp --value 2>/dev/null)
    state="RUNNING since ${since:-?}"
  else
    state="DIED without an exit marker — killed, not failed"
  fi
  printf '%-8s %s\n         log %s\n' "$name" "$state" "${log#$root/}"
done
[ "$found" = 1 ] || echo "no jobs recorded"
