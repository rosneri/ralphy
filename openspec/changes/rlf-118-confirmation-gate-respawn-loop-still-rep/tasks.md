# Tasks for RLF-118

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-118/confirmation-gate-respawn-loop-still-reproduces-after-rlf-105-fix and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add per-branch diagnostic logs to every `return false` site in `apps/agent/src/features/confirmation/awaiting.ts`. Lines emit through `deps.onLog` in the form `  <identifier>: confirmation detect released — <branch>` where `<branch>` is `disabled`, `gate-cleared`, `tasks-empty`, `outcome=approved`, or `outcome=revised`.
- [x] Wrap the body of `processAwaitingForIssue` in `apps/agent/src/features/confirmation/awaiting.ts` in a top-level try/catch. On throw: log `! confirmation detect threw for <identifier>: <message>` (yellow) and `return true` so the coordinator's registry walk continues to claim the ticket.
- [x] Create `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts` with a "second-poll resume preserves the claim" case: seed a tmpdir worktree with `openspec/changes/<name>/tasks.md` containing unchecked items and `.ralph/tasks/<name>/.ralph-state.json` matching the bug snapshot (`askedAt` set, `confirmedAt: null`, `rounds: 0`). Inject a stubbed `apiKey: ""`, `cfg.linear.confirmationMode.enabled: true`, and a `cwdOf` that returns the worktree path. Assert `processAwaitingForIssue` returns `true` and `deps.awaitingChangeSet.has(changeName)` is `true` after the call.
- [x] In the same test file add a "throw inside detect preserves the claim" case: stub `deps.cwdOf` to throw, capture `onLog` lines, assert the function returns `true` and the captured log includes a line matching `/confirmation detect threw for /`.
- [x] Run `bun run lint` and fix any new lint findings introduced by the diagnostic logs or the try/catch wrapper.
- [x] Run `bun run test` and fix any regressions. Confirm both new test cases pass and the existing `awaiting-confirmation.test.ts` and `poll-confirmation-claimed.test.ts` suites stay green.
- [x] Commit each implementation step in its own commit (staged with explicit paths — no `git add -A`). Push the branch, open the PR using the exact change-name as title.

## Manual Testing

- [x] `bunx openspec validate rlf-118-confirmation-gate-respawn-loop-still-rep` passes (proposal/design/spec delta well-formed).
- [x] In `apps/agent/src/features/confirmation/awaiting.ts`, every `return false` site is preceded by a matching `confirmation detect released — <branch>` log line (`disabled`, `gate-cleared`, `tasks-empty`, `outcome=approved`, `outcome=revised`).
- [x] In `apps/agent/src/features/confirmation/awaiting.ts`, the body of `processAwaitingForIssue` is wrapped in a top-level `try { ... } catch { log; return true }` so thrown errors keep the claim.
- [x] `bun run --filter @ralphy/agent test apps/agent/src/features/confirmation/__tests__/awaiting.test.ts` runs green (both new cases: resume-preserves-claim and throw-preserves-claim).
- [x] `bash scripts/check-no-unsafe-casts.sh` passes — no new `as any` / `as unknown` introduced by the test additions.
- [x] `bun run lint` is clean on the changed files.
