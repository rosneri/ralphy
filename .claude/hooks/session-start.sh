#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs Bun dependencies and advises on optional tooling.
set -euo pipefail

# Only run in Claude Code remote (cloud) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "=== SessionStart: preparing dev environment ==="

echo "Installing bun dependencies…"
bun install --frozen-lockfile

# Advisory: tools needed by shell-check hook.
if ! command -v shellcheck >/dev/null 2>&1; then
  echo ""
  echo "⚠  Optional tool not found (install manually if needed):"
  echo "   • shellcheck  →  apt-get install -y shellcheck"
  echo ""
fi

echo "=== SessionStart: done ==="
