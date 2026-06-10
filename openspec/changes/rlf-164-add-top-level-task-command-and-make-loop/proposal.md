# RLF-164: Add top-level `task` command and make `loop` orchestrate phases

Source: [RLF-164](https://linear.app/neriros/issue/RLF-164/add-top-level-task-command-and-make-loop-orchestrate-phases)
Status: Done
Assignee: Neriya Rosner
Labels: Refactor, Feature

## Why

Today `ralph loop task` owns everything: prompt construction, phase routing, and iteration control are all fused into a single monolithic path. The prompt builder (`buildTaskPrompt`) injects different content depending on which tasks.md items are checked, but the logic for each phase—research, planning, execution, review—lives inline with no clean seam. The agent's worker spawner always emits `ralph loop task` regardless of which phase the change is actually in.

This makes it harder to:

- run a single phase directly (e.g. re-run just the review pass)
- let the agent choose the right phase based on Linear signals rather than assuming one catch-all entrypoint
- add richer phase-specific behavior (RLF-76 review, RLF-162 stage-aware prompts) without further coupling
- keep structural phase (artifact state), behavioral flow (CI repair, push retry), and operator intent separate

## Summary

Introduce `ralph task <phase>` as a new top-level command—sibling of `loop` and `agent`—with sub-commands `research`, `plan`, `execute`, and `review`. Extract phase-specific prompt construction out of the monolithic `buildTaskPrompt` into dedicated builders shared by both the new `task` command and the existing `loop` command.

`loop` continues to work as before but now delegates prompt building to the same shared code that powers `ralph task`. This creates the architectural boundary the issue calls for without breaking any existing workflow.

## Desired shape

```bash
ralph task research --name foo   # context gathering / issue reading
ralph task plan     --name foo   # produce proposal.md / design.md / tasks.md
ralph task execute  --name foo   # work through tasks.md items (current loop behavior)
ralph task review   --name foo   # run a self-review pass
```

The important boundary:

- `task` executes one phase intentionally and independently
- `loop` decides repetition and ordering (for now, unchanged: it still drives the execute phase)
- `agent` decides which issue/change to work on (for now, still spawns `loop task`; foundation laid to pick `task <phase>`)

## Scope

### 1. New top-level CLI surface

- Add `"task"` to the shell subcommand set in `apps/shell/src/index.ts`
- Add `apps/loop/src/task-cli.ts` — parse `ralph task <phase> [options]`
- Export `taskMain` from `apps/loop/src/index.ts` (or a separate task entry)
- All options that apply to `loop task` also apply to `ralph task <phase>` (`--name`, `--claude`, `--max-iterations`, etc.)

### 2. Phase-specific prompt builders in core

- Add `TaskPhase = "research" | "plan" | "execute" | "review"` to `packages/core/src/loop.ts`
- Add `buildPhasePrompt(phase, state, taskDir, reviewPhase?)` that routes to:
  - `buildResearchPrompt` — reads context, does not modify artifacts
  - `buildPlanPrompt` — focuses on openspec planning artifacts
  - `buildExecutePrompt` — current `buildTaskPrompt` body (renamed)
  - `buildReviewPrompt` — self-review pass instructions
- Keep `buildTaskPrompt` as a re-export alias of `buildExecutePrompt` for backward compatibility

### 3. `useLoop` accepts an optional phase

- Add `phase?: TaskPhase` to `LoopOptions`; defaults to `"execute"` when absent
- Replace the hardcoded `buildTaskPrompt` call with `buildPhasePrompt(opts.phase ?? "execute", ...)`
- No behavior change for existing callers that omit `phase`

### 4. `loop` wiring unchanged

- `ralph loop task` continues to work exactly as before (phase defaults to `"execute"`)
- No change to `useLoop.ts` beyond accepting the new optional field and routing through `buildPhasePrompt`

### 5. Agent foundation (minimal)

- No change to `worker.ts` in this issue — it continues to emit `ralph loop task`
- The design makes it straightforward for a follow-up to switch to `ralph task execute` or pick the phase from `deriveOpenSpecPhase`

## Acceptance criteria

- `ralph task research|plan|execute|review --name <name>` runs without going through `loop`
- `ralph loop task --name <name>` behaves identically to today (no regression)
- `ralph task execute` and `ralph loop task` use the same underlying prompt builder (`buildExecutePrompt`)
- Phase-specific prompt builders exist in `packages/core/src/loop.ts` for all four phases
- `ralph task --help` prints usage including the phase sub-commands
- All existing tests pass; new unit tests cover `buildPhasePrompt` routing

## What Changes

- **`apps/shell/src/index.ts`** — add `"task"` to `SUBCOMMANDS`, dispatch to `@ralphy/loop`'s `taskMain`
- **`apps/loop/src/task-cli.ts`** (new) — CLI parser for `ralph task <phase> [options]`; produces a `TaskParsedArgs` with `phase: TaskPhase`
- **`apps/loop/src/index.ts`** — export `taskMain(argv)` that parses args, creates dirs, renders the TUI app with the phase set
- **`apps/loop/src/components/App.tsx`** — accept `taskPhase?: TaskPhase` in props; pass it through to `TaskModeWrapper`
- **`apps/loop/src/components/TaskLoop.tsx`** (if it exists) — forward `phase` into `useLoop`
- **`packages/core/src/loop.ts`** — add `TaskPhase` type; rename `buildTaskPrompt` → `buildExecutePrompt`; add `buildResearchPrompt`, `buildPlanPrompt`, `buildReviewPrompt`; add `buildPhasePrompt` router; keep `buildTaskPrompt` as alias
- **`apps/loop/src/hooks/useLoop.ts`** — add `phase?: TaskPhase` to `LoopOptions`; call `buildPhasePrompt(opts.phase ?? "execute", ...)` instead of `buildTaskPrompt`

## Implementation notes

- `task` is dispatched from the shell in the same way `loop` and `agent` are — same telemetry init, bus wiring
- The TUI rendered by `ralph task <phase>` is identical to `ralph loop task`; only the prompt builder differs
- `buildResearchPrompt` and `buildPlanPrompt` may reference the openspec artifact paths explicitly so the AI knows what to produce
- `buildReviewPrompt` may be the same content as the current review-phase injection in `buildTaskPrompt`, extracted out
- The `phase` field should be included in the loop state history so it is visible in logs and JSON output (nice-to-have, can be deferred)

## Related issues

- [RLF-76](https://linear.app/neriros/issue/RLF-76/add-a-self-review-phase-that-loops-back-to-design-when-findings-remain) — richer review behavior builds on top of `task review`
- [RLF-87](https://linear.app/neriros/issue/RLF-87/decouple-agent-into-capabilities-detections-flows-with-an-explicit) — broader agent decoupling direction
- [RLF-162](https://linear.app/neriros/issue/RLF-162/add-stage-aware-meta-prompt-layer-in-ralphy-injected-alongside) — stage-aware meta-prompt can layer on top once `phase` is in scope

## Open questions

- Should the loop's self-review pass (in `useLoop.ts`) be moved entirely into `buildReviewPrompt` + a new `task review` call, or remain as a special inlined orchestration step?
- Should `phase` be persisted to `.ralph-state.json` so the TUI and logs show which phase was invoked?
- For `task plan`, should the prompt instruct the AI to create all three artifacts (proposal, design, tasks) in sequence, or focus on whichever is the next stub?

## Non-goals

- Fully implementing richer review-round behavior (RLF-76)
- Redesigning agent routing to use `task` commands (follow-up)
- Changing workflow semantics unrelated to the new `task` boundary
- Changing how `loop` decides when to stop iterating

## Steering

_Add steering notes here as the loop runs._
