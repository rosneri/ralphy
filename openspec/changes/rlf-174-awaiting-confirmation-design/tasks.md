# Tasks for RLF-174

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-174/awaiting-confirmation-design and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

---

**Tracking progress**: as you finish each item above, edit `/Users/neri/.ralph/ralphy/worktrees/rlf-174/openspec/changes/rlf-174-awaiting-confirmation-design/tasks.md` and change its `- [ ]` to `- [x]` in the same commit. The loop reads this file between iterations and stops when no `- [ ]` items remain — if you do not tick the box, the next iteration will repeat this task.

Change name: `rlf-174-awaiting-confirmation-design`

Run `bunx openspec validate rlf-174-awaiting-confirmation-design` before committing.
Commit all changed files yourself before finishing — stage files individually (e.g. `git add path/to/file`), never `git add -A` or `git commit -am`. Nothing is committed automatically after you exit.

When all tasks are complete and all files are committed, push your branch and open a pull request:
git push -u origin HEAD
gh pr create --title "rlf-174-awaiting-confirmation-design" --body "Summary of changes for rlf-174-awaiting-confirmation-design"
Use the change name as the PR title and write a concise summary of the implementation in the body.

## Implementation

- [ ] In `apps/agent/src/components/AgentMode.tsx`, modify the gated-tickets IIFE (currently lines 1072-1118): when `gatedTicketsRef.current.size >= 2`, render a single `LabeledBox` whose label is a horizontal list of all ticket identifiers as `<Link>` nodes separated by `·`, and whose body shows `[GATE] Awaiting confirmation · N tickets`; remove the "+N more awaiting confirmation" text entirely.
- [ ] Add a test in `apps/agent/src/__tests__/pending-tasks.test.ts` (or a new test file) that verifies the label visual-width calculation for the multi-ticket case: `sum of identifier lengths + (count - 1) * 3 + 2`.
- [ ] Run `bun run lint` and fix any issues.
- [ ] Run `bun run test` and confirm all tests pass.
