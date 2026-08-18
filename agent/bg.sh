#!/usr/bin/env bash
# Start a long job that outlives this agent run.
#
# The agent runs as the systemd user unit fos.service, Type=oneshot. When the
# `claude -p` process returns, ExecStart is finished, systemd deactivates the
# unit, and the default KillMode=control-group SIGTERMs every process still in
# fos.service's cgroup. That is what killed the builds in runs 1 and 2.
#
# nohup does not help: the kill is not a HUP. setsid does not help either, and
# this is the trap — a new session is still the same cgroup, and systemd kills
# by cgroup membership, not by session or process tree. Run 2 verified the job
# had its own session and concluded it was therefore safe; it was not.
#
# The only thing that escapes is a different cgroup, so the job is launched as
# its own transient user unit:
#
#   ./agent/bg.sh build ./mach build
#
# lands in app.slice/fos-job-build.service, a sibling of fos.service rather
# than a child, and survives any number of agent restarts.
#
# Writes agent/logs/<name>-<epoch>.log and appends "=== EXIT <code> ===" as its
# last line. Check that marker rather than guessing from a log that stops: a
# truncated log and a clean finish look identical without it.
set -euo pipefail

name=${1:?usage: bg.sh <name> <command...>}
shift
[ $# -gt 0 ] || { echo "bg.sh: no command given" >&2; exit 2; }

# A single argument holding spaces is a shell line, not a program name. Two
# jobs have already been lost to `bg.sh push 'git push origin agent/dev'`
# failing with exit 127 an hour after the run that started it had ended, which
# is the most expensive way possible to find out about a quoting mistake.
if [ $# -eq 1 ] && [ "${1#*[[:space:]]}" != "$1" ]; then
  set -- bash -c "$1"
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
unit="fos-job-$name"
mkdir -p "$root/agent/logs"

# Refuse to start a second copy. A half-finished build plus a fresh one racing
# on the same objdir corrupts it, and that is expensive to notice.
if systemctl --user is-active --quiet "$unit.service" 2>/dev/null; then
  echo "bg.sh: $unit is already running — not starting a second copy" >&2
  exit 3
fi
systemctl --user reset-failed "$unit.service" 2>/dev/null || true

log="$root/agent/logs/$name-$(date +%s).log"
ln -sfn "$(basename "$log")" "$root/agent/logs/$name.current"

# --collect drops the unit's record once it exits, so the next run can reuse
# the name. The exit marker in the log, not systemd, is the record that lasts.
systemd-run --user --unit="$unit" --collect --same-dir \
  --setenv=HOME="$HOME" --setenv=SHELL=/bin/bash \
  bash -c '
    cd "$1"; shift
    log="$1"; shift
    exec > "$log" 2>&1 < /dev/null
    source agent/env.sh
    echo "=== START $(date -u +%FT%TZ): $* ==="
    "$@"
    code=$?
    echo "=== EXIT $code ==="
    exit $code
  ' _ "$root" "$log" "$@" >/dev/null

echo "started $name as $unit.service log=${log#$root/}"
