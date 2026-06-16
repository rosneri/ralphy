#!/usr/bin/env bash
# Launch the Ralph agent inside a memory-capped systemd user scope.
#
# The fleet (coordinator + workers + engine subprocesses) runs in one cgroup
# with a hard MemoryMax. When a leak crosses the cap, the cgroup OOM-killer
# kills the largest task IN THIS UNIT — and journald records it — instead of a
# silent global OOM that takes the whole box (and every other process) down.
#
# Usage (run from the repo whose agent you want, e.g. ~/Developer/ralphy):
#   bash scripts/agent-capped.sh --json-log-file ~/.ralph/agent-rlf.jsonl
# Tune the cap:  RALPH_MEM_MAX=20G bash scripts/agent-capped.sh ...
# After a kill:  journalctl --user -u <unit printed below> | tail
set -u
# Run in-place instead of letting the agent re-exec into its own tmux session
# (apps/agent/src/index.ts) — otherwise the real process lands in a separate
# tmux-spawn scope and escapes this unit's MemoryMax. The caller is expected to
# provide the terminal (run this inside tmux), same as the managed launch.
export RALPH_AGENT_MANAGED=1
MAX="${RALPH_MEM_MAX:-16G}"
SWAP="${RALPH_SWAP_MAX:-2G}"
UNIT="ralphy-agent-$(date -u +%Y%m%d-%H%M%S)"
echo "▶ unit=${UNIT}  MemoryMax=${MAX}  MemorySwapMax=${SWAP}"
echo "  on kill:  journalctl --user -u ${UNIT} | tail"
exec systemd-run --user --scope \
  -p MemoryMax="$MAX" -p MemorySwapMax="$SWAP" \
  --unit="$UNIT" \
  bun run ralphy agent "$@"
