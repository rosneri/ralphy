#!/usr/bin/env bash
# RSS sampler for the Ralph agent fleet.
#
# Because the recurring crash is an OOM SIGKILL, the agent can't log *why* it
# died — and we don't yet know *which* process leaks. This samples every
# ralph-related process's resident memory every INTERVAL seconds and appends it
# to LOG, flagging any process over THRESH_MB. After a crash, the last sample
# before the gap names the process that ballooned and shows how fast it grew.
#
# Usage:  bash scripts/mem-watch.sh [interval_s] [logfile] [threshold_mb]
# Example: bash scripts/mem-watch.sh 30 ~/.ralph/mem-watch.log 4000
set -u
INTERVAL="${1:-30}"
LOG="${2:-$HOME/.ralph/mem-watch.log}"
THRESH="${3:-4000}"
mkdir -p "$(dirname "$LOG")"
echo "# mem-watch start $(date -u +%FT%TZ)  interval=${INTERVAL}s  threshold=${THRESH}MB  log=$LOG" | tee -a "$LOG"

tag() {
  case "$1" in
    *"shell.js agent"*|*" agent "*) echo "coord" ;;
    *worktrees/*)                   echo "worker:$(printf '%s' "$1" | grep -oE 'worktrees/[^/ ]+' | head -1 | cut -d/ -f2)" ;;
    *"shell.js task"*|*" task "*)   echo "worker" ;;
    *mcp.js*)                       echo "mcp" ;;
    *claude*)                       echo "engine" ;;
    *)                              echo "ralph" ;;
  esac
}

while true; do
  ts=$(date -u +%FT%TZ)
  # SC2009: pgrep can't emit RSS + full args in one shot, which is the whole
  # point here — we need per-process memory next to the command to tag it.
  # shellcheck disable=SC2009
  sample=$(ps -eo pid=,rss=,args= | grep -E 'shell\.js|\.ralph/bin|[c]laude ' | grep -vE 'mem-watch')
  total=0
  out=""
  while read -r pid rss args; do
    [ -z "${pid:-}" ] && continue
    mb=$(( rss / 1024 ))
    total=$(( total + mb ))
    flag=""
    [ "$mb" -ge "$THRESH" ] && flag="  *** OVER ${THRESH}MB ***"
    out="${out}${ts}  pid=${pid}  rss=${mb}MB  $(tag "$args")${flag}"$'\n'
  done <<< "$sample"
  out="${out}${ts}  TOTAL=${total}MB"
  printf '%s\n' "$out" | tee -a "$LOG"
  sleep "$INTERVAL"
done
