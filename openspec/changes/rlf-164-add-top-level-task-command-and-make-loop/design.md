# Design for RLF-164

## Overview

Add `ralph task <phase>` as a new top-level CLI command backed by phase-specific prompt builders extracted from the existing monolithic `buildTaskPrompt`. The `loop` command continues to work unchanged; it now delegates prompt building to the same shared code.

## File Inventory

### New files

| File                        | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `apps/loop/src/task-cli.ts` | Arg parser for `ralph task <phase> [options]`; produces `TaskParsedArgs` |

### Modified files

| File                               | Change                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/shell/src/index.ts`          | Add `"task"` to `SUBCOMMANDS`; dispatch to `taskMain` from `@ralphy/loop`                                                                                             |
| `apps/loop/src/index.ts`           | Export `taskMain(argv)`                                                                                                                                               |
| `apps/loop/src/cli.ts`             | Re-export `TaskPhase` from core; no parser change                                                                                                                     |
| `apps/loop/src/components/App.tsx` | Accept `taskPhase?: TaskPhase` in `AppProps`; pass to `TaskModeWrapper`                                                                                               |
| `apps/loop/src/hooks/useLoop.ts`   | Add `phase?: TaskPhase` to `LoopOptions`; route `buildPhasePrompt` instead of `buildTaskPrompt`                                                                       |
| `packages/core/src/loop.ts`        | Extract `buildExecutePrompt`; add `buildResearchPrompt`, `buildPlanPrompt`, `buildReviewPrompt`, `buildPhasePrompt`; keep `buildTaskPrompt` alias; export `TaskPhase` |

## Data Flow

```
ralph task execute --name foo
  └─ apps/shell/src/index.ts (dispatch "task" → taskMain)
       └─ apps/loop/src/index.ts taskMain()
            └─ apps/loop/src/task-cli.ts parseTaskArgs()
                 → TaskParsedArgs { phase: "execute", name: "foo", ... }
            └─ apps/loop/src/components/App.tsx (render with taskPhase="execute")
                 └─ TaskModeWrapper (LoopOptions { phase: "execute", ... })
                      └─ useLoop.ts
                           └─ buildPhasePrompt("execute", state, taskDir)
                                └─ buildExecutePrompt(state, taskDir) ← same code as before
```

```
ralph loop task --name foo   ← unchanged path
  └─ apps/loop/src/index.ts main()
       └─ App.tsx (no taskPhase)
            └─ useLoop.ts (phase: undefined → default "execute")
                 └─ buildPhasePrompt("execute", ...) → buildExecutePrompt(...)
```

## Detailed Changes

### `packages/core/src/loop.ts`

```typescript
// New type
export type TaskPhase = "research" | "plan" | "execute" | "review";

// Rename existing buildTaskPrompt → buildExecutePrompt (keep alias)
export function buildExecutePrompt(state, taskDir, reviewPhase?): string {
  /* current body */
}
export const buildTaskPrompt = buildExecutePrompt; // backward-compat alias

// New phase-specific builders
export function buildResearchPrompt(state, taskDir): string {
  // Instructs the AI to:
  // 1. Read the Linear issue (from proposal.md if present, or prompt)
  // 2. Explore the codebase structure relevant to the issue
  // 3. Write a research summary (or notes in proposal.md ## Research section)
  // No tasks.md interaction; read-only pass
}

export function buildPlanPrompt(state, taskDir): string {
  // Instructs the AI to produce/refine:
  // - openspec/changes/<name>/proposal.md (Why + What Changes + Acceptance Criteria)
  // - openspec/changes/<name>/design.md (technical design)
  // - .ralph/tasks/<name>/tasks.md (implementation checklist)
  // References isStubArtifact to describe which artifacts still need filling
}

export function buildReviewPrompt(state, taskDir): string {
  // Instructs the AI to:
  // 1. Read proposal.md and design.md
  // 2. Run git diff main
  // 3. Check against acceptance criteria
  // 4. Write review-findings.md with open/resolved sections
  // (Extracted from current inline review-phase injection in buildExecutePrompt)
}

// Router
export function buildPhasePrompt(phase: TaskPhase, state, taskDir, reviewPhase?): string {
  switch (phase) {
    case "research":
      return buildResearchPrompt(state, taskDir);
    case "plan":
      return buildPlanPrompt(state, taskDir);
    case "execute":
      return buildExecutePrompt(state, taskDir, reviewPhase);
    case "review":
      return buildReviewPrompt(state, taskDir);
  }
}
```

### `apps/loop/src/task-cli.ts` (new)

```typescript
export type TaskPhase = "research" | "plan" | "execute" | "review";

export interface TaskParsedArgs extends CommonArgs {
  phase: TaskPhase;
  name: string;
  prompt: string;
  fromAgent: boolean;
}

const VALID_PHASES = new Set<string>(["research", "plan", "execute", "review"]);

export function printTaskHelp(): void { ... }
export async function parseTaskArgs(argv: string[]): Promise<TaskParsedArgs> { ... }
```

### `apps/loop/src/index.ts`

Add alongside existing `main`:

```typescript
export async function taskMain(argv: string[]): Promise<number> {
  // parse args (phase is first positional, rest same as loop task)
  // mkdir statesDir/name, tasksDir/name
  // render App with taskPhase set
}
```

### `apps/loop/src/hooks/useLoop.ts`

```typescript
export interface LoopOptions {
  // ... existing fields
  phase?: TaskPhase; // ← new optional field; defaults to "execute"
}

// In the iteration body, replace:
//   const prompt = buildTaskPrompt(currentState, tasksDir);
// with:
//   const prompt = buildPhasePrompt(opts.phase ?? "execute", currentState, tasksDir, opts.reviewPhase);
```

### `apps/loop/src/components/App.tsx`

```typescript
interface AppProps {
  args: LoopParsedArgs;
  taskPhase?: TaskPhase; // ← new; set by taskMain, absent for loop main
  statesDir: string;
  tasksDir: string;
  projectRoot: string;
}
```

Pass `taskPhase` down into `TaskModeWrapper` → `LoopOptions`.

### `apps/shell/src/index.ts`

```typescript
const SUBCOMMANDS = new Set<string>(["loop", "agent", "task"]);

// In dispatch():
if (subcommand === "task") {
  const { taskMain } = await import("@ralphy/loop");
  return taskMain(rest);
}

// In HELP:
("  task      Run a single phase (research, plan, execute, review)");
```

## Edge Cases

| Scenario                                                 | Handling                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ralph task execute` without `--name`                    | Error: `--name is required`                                                                                             |
| `ralph task unknown-phase`                               | Error: `Unknown phase 'unknown-phase'. Valid phases: research, plan, execute, review`                                   |
| `ralph task execute --name foo` on a non-existent change | Loop scaffolds state as normal (same as `loop task`)                                                                    |
| `ralph loop task` (existing workflow)                    | `phase` defaults to `"execute"` — identical behavior                                                                    |
| `buildExecutePrompt` called for `loop task`              | Same function, same output — no regression                                                                              |
| Review phase in `loop task`                              | `reviewPhase` arg forwarded through `buildPhasePrompt("execute", ..., reviewPhase)` to `buildExecutePrompt` — no change |
| `ralph task review` while tasks are incomplete           | Prompt instructs a review pass; AI may note tasks are incomplete. No hard guard — operator intent is explicit           |

## Test Plan

- Unit tests for `buildPhasePrompt` router in `packages/core/src/__tests__/loop.test.ts`
- Unit tests for `parseTaskArgs` in a new `apps/loop/src/__tests__/task-cli.test.ts`
- Existing `loop.test.ts` tests continue to pass (buildTaskPrompt alias works)
- Integration smoke: `ralph task --help` and `ralph task execute --help` exit 0 with expected output

## What Is NOT Changed

- `apps/agent/src/agent/wire/spawn/worker.ts` — still emits `ralph loop task`; phase-aware agent routing is deferred
- The review orchestration loop inside `useLoop.ts` — the self-review pass stays as inline orchestration for now; the `buildReviewPrompt` extraction makes it easy to move in a follow-up
- `openspec/phase.ts` — artifact-phase derivation is untouched
- No changes to the TUI rendering, state schema, or telemetry events
