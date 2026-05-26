# duplicate-check Specification

## Purpose

TBD - created by archiving change rlf-146-port-check-duplicate-declarations-script. Update Purpose after archive.

## Requirements

### Requirement: CI MUST block PRs that introduce same-name declarations

`scripts/check-duplicate-declarations.ts --diff` SHALL run as a CI step on every PR. If the changed files introduce a new same-name declaration (function, type, interface, enum, class, or variable without `// allow-duplicate`) that matches one already declared in another file, CI MUST exit non-zero and block the PR.

#### Scenario: PR adds a function already declared elsewhere

Given a PR that adds `function foo` to `apps/agent/src/foo.ts`
And `function foo` already exists in `apps/loop/src/bar.ts`
When the CI "No duplicate declarations" step runs
Then it exits 1 and reports the violation

#### Scenario: PR touches a file with a pre-existing duplicate but does not introduce a new one

Given a PR that modifies `apps/agent/src/existing.ts` (only changes a comment)
And `apps/agent/src/existing.ts` already had a same-name declaration before this PR
When the CI "No duplicate declarations" step runs
Then it exits 0 (pre-existing violations in untouched files MUST NOT block unrelated PRs)

#### Scenario: Pre-push hook blocks a push that introduces a violation

Given a developer pushes a branch that adds a duplicate function name
When `.husky/pre-push` runs
Then the push SHALL be aborted with a non-zero exit and the violation reported

### Requirement: Ralphy-specific convention patterns SHALL NOT be flagged

The script's `CONVENTION_ALLOWLIST` MUST include ralphy-specific entries so that intentional same-name patterns are not treated as violations.

#### Scenario: App entry-point `main` is not flagged

Given `apps/agent/src/index.ts` and `apps/loop/src/index.ts` both declare `function main`
When `check-duplicate-declarations.ts --all` runs
Then `main` MUST NOT be reported as a violation

#### Scenario: Per-feature event emitters are not flagged

Given `apps/agent/src/features/ci-fix/events.ts` and `apps/agent/src/features/implement/events.ts` both declare `function emitCompleted`
When `check-duplicate-declarations.ts --all` runs
Then `emitCompleted` MUST NOT be reported as a violation

#### Scenario: Cross-app same-name UI components are not flagged

Given `apps/ui/src/components/StatusBar.tsx` and `apps/loop/src/components/StatusBar.tsx` both declare `function StatusBar`
When `check-duplicate-declarations.ts --all` runs
Then `StatusBar` MUST NOT be reported as a violation

### Requirement: Full repo scan MUST exit 0 after cleanup

After all violation fixes are applied, `bun scripts/check-duplicate-declarations.ts --all` SHALL exit 0 with no reported violations.

#### Scenario: Clean repo scan

Given all 38 existing violations have been fixed
When `bun scripts/check-duplicate-declarations.ts --all` runs
Then it SHALL exit 0 and print "✓ No duplication detected in the whole repo."
