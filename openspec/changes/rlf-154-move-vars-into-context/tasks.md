# Tasks for RLF-154

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-154/move-vars-into-context and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Extend `AppContext` in `packages/context/src/context.ts` to add `layout?: ProjectLayout` and `args?: CommonArgs` fields; import `ProjectLayout` from `@ralphy/core` and `CommonArgs` from `@ralphy/cli-args`
- [x] Export `getLayout(): ProjectLayout` and `getArgs(): CommonArgs` accessor helpers from `packages/context/src/context.ts` (both throw a descriptive error when the field is absent)
- [x] Update `createDefaultContext()` signature to accept an optional overrides bag `{ layout?, args? }` so entry points can populate context concisely
- [x] Add unit tests in `packages/context/src/__tests__/context.test.ts` covering: `getLayout()` throws when absent, returns value when present; same for `getArgs()`
- [x] Wire `layout` and `args` into `runWithContext()` in the `apps/loop` CLI entry point so all loop execution runs with a populated context
- [x] Wire `layout` and `args` into `runWithContext()` in the `apps/agent` CLI entry point; use nested `runWithContext()` with per-worktree layout for per-change workers
- [x] Add `layoutFromContext()` helper to `packages/core/src/layout.ts` as a thin wrapper over `getLayout()`; keep `projectLayout(root)` unchanged
- [x] Audit `packages/core` for functions that receive `projectRoot`, `statesDir`, or `tasksDir` only to pass them deeper; replace those parameters with `getLayout()` calls and remove the now-redundant parameters from their signatures
- [x] Audit `apps/loop` and `apps/agent` for functions that thread `args` purely as pass-through; replace with `getArgs()` calls and remove the parameters
- [x] Update all affected call sites (both in packages and apps) to match the new signatures
- [x] Update any tests that constructed explicit path/args parameters for the affected functions to use `runWithContext({ storage, layout, args }, ...)` instead
- [x] Run `bun run lint` and confirm no lint errors
- [x] Run `bun run test` and confirm all tests pass with coverage threshold met
