#!/bin/bash
# PreToolUse hook — runs the duplicate-declaration check before `gh pr create`.
# Reads the tool input JSON from stdin; if the Bash command isn't a `gh pr create`,
# the hook is a no-op. On detected duplicates, exits 2 to block the tool call.

set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Only fire for `gh pr create` invocations.
case "$command" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac

# Escape hatch: prefix the command with SKIP_DUPLICATE_CHECK=1, or export it in the
# environment, to bypass this hook. Use for cleanup PRs that touch files with
# pre-existing duplicates outside the PR's scope.
if [ "${SKIP_DUPLICATE_CHECK:-}" = "1" ] || [[ "$command" == *"SKIP_DUPLICATE_CHECK=1"* ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if ! bun scripts/check-duplicate-declarations.ts --diff 1>&2; then
  cat 1>&2 <<'EOF'

Blocking `gh pr create`: duplicate top-level declarations detected in the diff.
Fix the duplicates above (or, for const/let/var only, add `// allow-duplicate`
above each occurrence) and try again.
EOF
  exit 2
fi

exit 0
