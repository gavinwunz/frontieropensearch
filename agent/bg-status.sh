#!/usr/bin/env bash
# Report on every job started by bg.sh. Run this first thing each run.
set -uo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

shopt -s nullglob
for pidfile in "$root"/agent/logs/*.pid; do
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  log=$(ls -t "$root"/agent/logs/"$name"-*.log 2>/dev/null | head -1)
  marker=$(tail -1 "$log" 2>/dev/null | grep -o '=== EXIT [0-9]* ===' || true)

  if [ -n "$marker" ]; then
    state="finished ${marker}"
  elif kill -0 "$pid" 2>/dev/null; then
    state="RUNNING (pid $pid, $(ps -p "$pid" -o etime= | tr -d ' ') elapsed)"
  else
    state="DIED without writing an exit marker — killed, not failed"
  fi
  printf '%-8s %s\n         log %s\n' "$name" "$state" "${log#$root/}"
done
