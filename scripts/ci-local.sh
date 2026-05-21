#!/usr/bin/env bash
set -euo pipefail

# Local CI — mirrors .github/workflows/ci.yml without CI overhead.
# Usage:
#   ./scripts/ci-local.sh          # run all stages
#   ./scripts/ci-local.sh static   # run only static checks
#   ./scripts/ci-local.sh test     # run only tests
#   ./scripts/ci-local.sh build    # run only build + audit

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BOLD=$'\033[1m'
NC=$'\033[0m'

FAILED=()
PASSED=()
START_TIME=$SECONDS

run_step() {
  local name="$1"
  shift
  printf '%s▶ %s%s\n' "$BOLD" "$name" "$NC"
  local step_start=$SECONDS
  if "$@" 2>&1; then
    local elapsed=$(( SECONDS - step_start ))
    PASSED+=("$name (${elapsed}s)")
    printf '%s  ✓ %s (%ds)%s\n' "$GREEN" "$name" "$elapsed" "$NC"
  else
    local elapsed=$(( SECONDS - step_start ))
    FAILED+=("$name (${elapsed}s)")
    printf '%s  ✗ %s (%ds)%s\n' "$RED" "$name" "$elapsed" "$NC"
  fi
}

stage_static() {
  printf '\n%s━━━ Static Checks ━━━%s\n\n' "$YELLOW" "$NC"

  run_step "No direct axios in apps/ui"   bun scripts/check-no-direct-http.ts
  run_step "No prop drilling in React components" bun scripts/check-prop-drilling.ts
  run_step "Hooks must live in useSomething files" bun scripts/check-hooks-location.ts
  run_step "Folder size check"            bun scripts/check-folder-size.ts
  run_step "Single component per TSX file" bun scripts/check-single-component.ts
  run_step "Static error messages (no template literals in Error/Exception constructors)" bun scripts/check-static-error-messages.ts
  run_step "No unsafe casts (as any / as unknown)" bash scripts/check-no-unsafe-casts.sh
  run_step "Shellcheck"                   bash -c 'find . -name "*.sh" -not -path "*/node_modules/*" -not -path "*/.husky/_/*" | xargs shellcheck'
  run_step "Lint (affected)"              bun run lint:ci
  run_step "Format check (affected)"      bun run fmt:ci
  NODE_OPTIONS=--max-old-space-size=8192 \
  run_step "Typecheck (affected)"         bun run typecheck:ci
  # run_step "Spell check"                  bunx cspell "**/*.{ts,tsx,js,mjs,mts,json,md}" --no-progress
  run_step "Architecture doc drift check" bash -c 'bun run build:architecture && git diff --exit-code ARCHITECTURE.md'
  run_step "Circular dependency check"    bun run check:circular:ci
  run_step "Unused dependency check"      bun run check:unused:ci
  run_step "Outdated dependency check"    bun scripts/check-outdated.ts
}

stage_test() {
  printf '\n%s━━━ Tests ━━━%s\n\n' "$YELLOW" "$NC"

  run_step "Test affected files + coverage"  bun run test:affected-files:coverage:ci
}

stage_build() {
  printf '\n%s━━━ Build ━━━%s\n\n' "$YELLOW" "$NC"

  run_step "Security audit"               bun audit --audit-level=high
  run_step "Build (affected)"             bun run build:ci
}

# Determine which stages to run
if [ $# -eq 0 ]; then
  stages=(static test build)
else
  stages=("$@")
fi

for stage in "${stages[@]}"; do
  case "$stage" in
    static) stage_static ;;
    test)   stage_test ;;
    build)  stage_build ;;
    *)      printf '%sUnknown stage: %s%s\n' "$RED" "$stage" "$NC"; exit 1 ;;
  esac
done

# Summary
TOTAL_TIME=$(( SECONDS - START_TIME ))
printf '\n%s━━━ Summary (%ds) ━━━%s\n' "$BOLD" "$TOTAL_TIME" "$NC"

if [ ${#PASSED[@]} -gt 0 ]; then
  for p in "${PASSED[@]}"; do
    printf '%s  ✓ %s%s\n' "$GREEN" "$p" "$NC"
  done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do
    printf '%s  ✗ %s%s\n' "$RED" "$f" "$NC"
  done
  printf '\n%s%sCI failed — %d step(s) failed%s\n' "$RED" "$BOLD" "${#FAILED[@]}" "$NC"
  exit 1
fi

printf '\n%s%sCI passed — all %d steps succeeded%s\n' "$GREEN" "$BOLD" "${#PASSED[@]}" "$NC"
