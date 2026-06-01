#!/bin/bash
# PreToolUse hook — deterministically blocks Edit/Write/MultiEdit on the validation
# scripts. Reads the tool input JSON from stdin, extracts the target file path, and
# checks it against PROTECTED below. On a match, exits 2 to block the tool call;
# exit 0 (no match) lets the edit proceed.
#
# Intent: freeze the EXISTING validation scripts so they can't be edited, while
# leaving Claude free to add NEW scripts and edit anything else. The list is
# explicit filenames (not a glob) precisely so a brand-new scripts/check-*.ts is
# NOT blocked. Add a line here when you add a validation script you want frozen.

set -euo pipefail

# ---------------------------------------------------------------------------
# Protected validation scripts, as paths relative to the project root.
# ---------------------------------------------------------------------------
PROTECTED=(
  "scripts/check-duplicate-declarations.ts"
  "scripts/check-folder-size.ts"
  "scripts/check-hooks-location.ts"
  "scripts/check-no-direct-http.ts"
  "scripts/check-no-unsafe-casts.sh"
  "scripts/check-outdated.ts"
  "scripts/check-prop-drilling.ts"
  "scripts/check-single-component.ts"
  "scripts/check-static-error-messages.ts"
  "scripts/check-filename-case.ts"
  "scripts/check-no-reexport-tsx.ts"
  "scripts/check-test-location.ts"
  "scripts/check-shell.sh"
  "scripts/check-ci-local-sync.ts"
  "scripts/prop-drilling-ast.ts"
)

input=$(cat)

# Edit/Write/MultiEdit all carry the target in tool_input.file_path.
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0  # nothing to check — allow.

proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${file_path#"$proj"/}"  # path relative to project root, if under it.

for p in "${PROTECTED[@]}"; do
  # Match the project-relative path, or any */<p> suffix so edits inside
  # .claude/worktrees/* (different absolute prefix) are caught too.
  if [ "$rel" = "$p" ] || [ "$file_path" = "$p" ] || [[ "$file_path" == */"$p" ]]; then
    cat 1>&2 <<EOF

Blocked: "$p" is a protected validation script and cannot be edited.
This is enforced by .claude/hooks/block-protected-edits.sh.
You may still create NEW scripts and edit non-validation files.
To intentionally unfreeze this one, remove it from PROTECTED in that hook script.
EOF
    exit 2
  fi
done

exit 0
