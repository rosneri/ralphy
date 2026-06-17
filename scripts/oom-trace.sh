#!/usr/bin/env bash
# High-frequency OOM tracer for the capped Ralph agent scope.
#
# mem-watch.sh samples by process-NAME grep at 30s — it misses (a) the 8-second
# spike and (b) any worker-spawned command (e.g. `bun scripts/foo.ts`) whose name
# doesn't match shell.js/claude. This instead follows the systemd scope's cgroup:
# it reads the unit's real memory.current and lists EVERY process in the cgroup
# with full cmdline + RSS, top-by-RSS, every INTERVAL seconds. The last sample
# before the OOM gap names the exact process and command that ballooned.
#
# Usage: bash scripts/oom-trace.sh [interval_s] [logfile]
set -u
INTERVAL="${1:-1}"
LOG="${2:-$HOME/.ralph/oom-trace.log}"
mkdir -p "$(dirname "$LOG")"
echo "# oom-trace start $(date -u +%FT%TZ)  interval=${INTERVAL}s  log=$LOG" | tee -a "$LOG"

find_scope() {
  # newest ralphy-agent-*.scope cgroup dir. SC2012: these are systemd-generated
  # alphanumeric scope names and we want newest-by-mtime, which `ls -dt` gives
  # directly; `find -printf | sort` would be strictly worse here.
  # shellcheck disable=SC2012
  ls -dt /sys/fs/cgroup/user.slice/user-*.slice/user@*.service/app.slice/ralphy-agent-*.scope 2>/dev/null | head -1
}

while true; do
  ts=$(date -u +%FT%TS%3NZ 2>/dev/null || date -u +%FT%TZ)
  scope=$(find_scope)
  if [ -z "${scope:-}" ] || [ ! -d "$scope" ]; then
    printf '%s  no-scope\n' "$ts" | tee -a "$LOG"
    sleep "$INTERVAL"; continue
  fi
  cur=$(cat "$scope/memory.current" 2>/dev/null || echo 0)
  cur_mb=$(( cur / 1048576 ))
  procs=$(cat "$scope/cgroup.procs" 2>/dev/null)
  out="${ts}  scope=$(basename "$scope")  memory.current=${cur_mb}MB"$'\n'
  # per-pid RSS + cmdline, sorted desc by RSS, top 8
  rows=""
  for pid in $procs; do
    [ -r "/proc/$pid/statm" ] || continue
    rsspages=$(awk '{print $2}' "/proc/$pid/statm" 2>/dev/null || echo 0)
    rssmb=$(( rsspages * 4096 / 1048576 ))
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-120)
    rows="${rows}${rssmb} ${pid} ${cmd}"$'\n'
  done
  top=$(printf '%s' "$rows" | sort -rn | head -8)
  while read -r m p c; do
    [ -z "${p:-}" ] && continue
    out="${out}    rss=${m}MB  pid=${p}  ${c}"$'\n'
  done <<< "$top"
  printf '%s' "$out" | tee -a "$LOG"
  sleep "$INTERVAL"
done
