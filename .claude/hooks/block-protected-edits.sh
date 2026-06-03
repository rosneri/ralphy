#!/bin/bash
# PreToolUse hook — blocks Edit/Write/MultiEdit against frozen validation scripts.
# Reads the tool input JSON from stdin, extracts `.tool_input.file_path`, and exits
# 2 (hard block) when the path resolves to a frozen `scripts/<name>` validator.
# For every other path it is a no-op (exit 0), so creating new scripts and editing
# non-frozen files (including `scripts/ci-local.sh`) stays allowed.

set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

# Nothing to guard (e.g. malformed input or a tool without a file_path).
[ -z "$file_path" ] && exit 0

# Explicit allowlist, NOT a glob: only these named scripts are frozen. A new
# `scripts/check-*.ts` is intentionally NOT blocked, and `scripts/ci-local.sh`
# is intentionally editable.
frozen=(
  check-duplicate-declarations.ts
  check-folder-size.ts
  check-hooks-location.ts
  check-no-direct-http.ts
  check-no-unsafe-casts.sh
  check-outdated.ts
  check-prop-drilling.ts
  check-single-component.ts
  check-static-error-messages.ts
  check-filename-case.ts
  check-no-reexport-tsx.ts
  check-test-location.ts
  check-shell.sh
  check-ci-local-sync.ts
  prop-drilling-ast.ts
)

for name in "${frozen[@]}"; do
  # Match the project-relative path or any `*/scripts/<name>` suffix (covers
  # absolute and worktree-prefixed paths like `.../scripts/check-shell.sh`).
  if [[ "$file_path" == "scripts/$name" || "$file_path" == */scripts/"$name" ]]; then
    cat 1>&2 <<EOF

Blocking edit to a frozen validation script: $file_path

\`scripts/$name\` is a deterministic project gate and must not be modified by the
agent. If a gate is failing, fix the underlying code so the check passes — do not
weaken the checker. To add a NEW validator, create a differently-named script
(e.g. \`scripts/check-foo.ts\`); new scripts are not frozen.
EOF
    exit 2
  fi
done

exit 0
