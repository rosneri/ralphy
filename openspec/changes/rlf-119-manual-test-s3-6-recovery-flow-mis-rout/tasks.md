# Tasks for RLF-119

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-119/manual-test-s36-recovery-flow-mis-routing-into-confirmation-gate-rlf and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Re-run `bunx openspec validate rlf-119-manual-test-s3-6-recovery-flow-mis-rout` and confirm it reports "is valid".
- [x] Cross-check the spec's regression-signature scenario against the current on-disk agent log format emitted by `apps/agent/src/runtime/coordinator.ts` (look for `awaiting:` and `queued (conflict-fix)` substrings) and reconcile any wording drift between the spec and the actual log strings.
- [x] Cross-check the pass-signature scenario against the conflict-fix exit path in `apps/agent/src/features/conflict-fix/index.ts` and confirm the label-clear + auto-merge sequence matches what a real run would produce.
- [x] Verify the spec's preconditions (opt-in label name, opt-out label name, default conflict label `ralph:conflict`) match the engine config defaults used by `NeriRos/ralphy-rlf87-test`; update the spec text if the defaults have drifted.
- [x] Confirm no source files under `apps/` or `packages/` were modified by this change (this is a spec-only delta) — run `git diff --name-only main...HEAD` and ensure all paths sit under `openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/`.
- [x] Run `bun run lint` from the repo root and confirm it exits 0 (no markdown/lint rules apply to the new files, but the repo-wide lint must still pass).
- [x] Run `bun run test` from the repo root and confirm the existing characterization tests (including the `test.failing` scenarios 3 and 5) still behave as before — i.e. this spec-only change does not move any passing test into failing or vice versa. (`bun run test` is not defined; ran `bun run test:ci` instead. Pre-existing failures in `AgentMode awaiting-confirmation` and `SteeringField` are unrelated to this spec-only change.)
- [x] Stage each modified file individually (`git add openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/proposal.md`, …/design.md, …/tasks.md, …/specs/manual-test-rlf87-recovery-routing/spec.md) and commit with a message referencing RLF-119.
- [x] Push the branch and open the PR with the change name as the title.
