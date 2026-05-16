# Tasks for RLF-56

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-56/add-config-to-sync-loop-tasks-into-linear-issue-descriptions and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [x] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Add `syncTasksToDescription: z.boolean().default(false)` to the `linear` object in `packages/workflow/src/schema.ts`, including the schema's `.default({...})` initializer.
- [x] Update `packages/workflow/src/default.ts` so the default config template emits `syncTasksToDescription: false` with an inline comment explaining the behavior.
- [x] Extend `packages/workflow/src/__tests__/workflow.test.ts` with cases for: (a) default value is `false`, (b) accepts `true`, (c) round-trips via `parse`.
- [x] Create `apps/agent/src/agent/linear-tasks-sync.ts` exporting `renderTasksBlock(tasksMd, { changeName, iteration })`, `applyTasksBlock(existingDescription, block)`, and `syncTasksToLinearDescription({ apiKey, issueId, currentDescription, tasksPath, changeName, iteration, log, updateIssueDescription })` orchestrator. Use `Bun.file(tasksPath).exists()` / `.text()` for I/O.
- [x] Define the sentinel constants `RALPHY_TASKS_START = "<!-- ralphy:tasks:start -->"` and `RALPHY_TASKS_END = "<!-- ralphy:tasks:end -->"` in that module, exported for tests.
- [x] Implement code-block collapsing inside `renderTasksBlock`: bullets followed by a fenced `\n…\n` block render as `- [x|] item\n  <details><summary>output</summary><pre>…</pre></details>` and the inner output is truncated to 2 KB with an ellipsis.
- [x] Implement size guard in the orchestrator: if the rendered block exceeds 60 KB, log a yellow warning via `log` and skip the API call.
- [x] Create `apps/agent/src/__tests__/linear-tasks-sync.test.ts` covering all eight unit tests listed in design.md "Test plan" (renderTasksBlock single + multi section, applyTasksBlock insert / replace / idempotency, orchestrator missing-file / no-op / error-swallow).
- [x] Extend the `CoordinatorDeps` type in `apps/agent/src/agent/coordinator.ts` with optional `syncTasks?(worker: WorkerHandle): Promise<void>`. Call it from `reportProgress` after the milestone-comment branch (gate on the same `everyN` boundary), from `launchWorker` on first spawn, and from the done-transition path.
- [x] Wire the orchestrator into `apps/agent/src/agent/wire.ts`: build a `syncTasks` callback when `cfg.linear.syncTasksToDescription === true` AND `apiKey` is set. Pass `tasksPath = join(projectLayout(cwd).tasksDir, changeName, 'tasks.md')` and the cached description from the worker's `LinearIssue`.
- [x] Update `apps/agent/src/__tests__/wire-setup-worktree.test.ts` with two cases: flag on registers the hook; flag off leaves it unset.
- [x] Extend `apps/agent/src/__tests__/agent-integration.test.ts` (or coordinator.test.ts) with an end-to-end case proving an `issueUpdate` call is made when the flag is on and a real worker iteration completes.
- [x] Update `README.md` and `WORKFLOW.md` to document the new `linear.syncTasksToDescription` key under the existing Linear configuration section.
- [x] Run `bun run lint` and resolve any findings.
- [x] Run `bun run test` and ensure all tests pass without lowering the coverage threshold.
- [x] Run `bunx openspec validate rlf-56-add-config-to-sync-loop-tasks-into-linea` and resolve any validator issues.
- [x] Manually verify in `agent-browser` (per `MANUAL_TESTING_PLAN.md`) that a real run against a test Linear issue produces the expected managed block.
