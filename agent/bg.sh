#!/usr/bin/env bash
# Start a long job that outlives this agent run.
#
# nohup alone is not enough. The supervisor restarts the agent by killing its
# process group, which takes any plain background child with it — that is how
# run 1 lost both a build and a push with no error in either log. setsid puts
# the job in a new session with no controlling terminal, so the group signal
# never reaches it.
#
#   ./agent/bg.sh build ./mach build
#
# Writes agent/logs/<name>-<epoch>.log, records the pid in
# agent/logs/<name>.pid, and appends "=== EXIT <code> ===" as the log's last
# line. Check that marker rather than guessing from a log that stops: a
# truncated log and a clean finish look identical without it.
set -euo pipefail

name=${1:?usage: bg.sh <name> <command...>}
shift
[ $# -gt 0 ] || { echo "bg.sh: no command given" >&2; exit 2; }

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
log="$root/agent/logs/$name-$(date +%s).log"
mkdir -p "$root/agent/logs"

setsid nohup bash -c '
  cd "$1"; shift
  log="$1"; shift
  source agent/env.sh
  echo "=== START $(date -u +%FT%TZ): $* ==="
  "$@"
  code=$?
  echo "=== EXIT $code ==="
  exit $code
' _ "$root" "$log" "$@" > "$log" 2>&1 < /dev/null &

pid=$!
disown "$pid" 2>/dev/null || true
echo "$pid" > "$root/agent/logs/$name.pid"
echo "started $name pid=$pid log=${log#$root/}"
