# Design for RLF-151: Support no-PR tasks with validate-only flow

## Revised design (2026-05-26)

Per steering: `validateOnComplete` is a per-task indicator, not a config or CLI parameter. The worker AI creates `openspec/changes/<name>/specs/validate.md` during the design phase to signal that this task needs a validation phase. The post-task handler detects this file to enter validate-only mode.

## Files Touched

| File                                        | Change                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workflow/src/schema.ts`           | Remove `validateOnComplete` from `WorkflowConfigSchema` (no longer a WORKFLOW.md setting)                                        |
| `packages/types/src/types.ts`               | Keep `validateOnComplete: z.boolean().default(false)` in `StateSchema` — runtime indicator set from spec file                    |
| `packages/core/src/state.ts`                | Remove `validateOnComplete` from `BuildInitialStateOptions`; field still exists in StateSchema with default `false`              |
| `packages/core/src/loop.ts`                 | Remove `validateOnComplete` from `LoopOptions`; `buildTaskPrompt` still reads `state.validateOnComplete` (set from file)         |
| `apps/loop/src/cli.ts`                      | Remove `--validate-on-complete` flag and `validateOnComplete` from `LoopParsedArgs`                                              |
| `apps/loop/src/components/App.tsx`          | Remove `validateOnComplete` from opts; `createPr: args.fromAgent` (no longer gated on validateOnComplete)                        |
| `apps/loop/src/hooks/useLoop.ts`            | Remove `validateOnComplete` from `buildInitialState` call; skip `getStatus()` check still uses `currentState.validateOnComplete` |
| `apps/agent/src/agent/post-task.ts`         | Unchanged — `runValidateOnlyPhase` still handles post-worker validation                                                          |
| `apps/agent/src/agent/wire/spawn/worker.ts` | Detect `wantValidateOnly` from `specs/validate.md` existence (async, inside wrapped closure); update state when detected         |

## New Data Flow

```
Worker AI (design phase) → writes openspec/changes/<name>/specs/validate.md
  ↓
Worker AI (implementation phase) → completes tasks
  ↓
Worker exits
  ↓
wire (wrapped closure):
  hasValidateSpec = await Bun.file("<changeDir>/specs/validate.md").exists()
  wantValidateOnly = hasValidateSpec && !wantPrBase
  if (hasValidateSpec && !state.validateOnComplete):
    update state: { validateOnComplete: true, createPr: false }
  ↓
runPostTask(wantValidateOnly=true, exitCode=0)
  → runValidateOnlyPhase(validateCommands=[...])
      step 1: run each validateCommand via cmd.run(["sh","-c",cmd], cwd)
        fail → prepend fix task → respawnWorker → return exit code
      step 2: prepend "## Validate: verify your work is complete" to agent-tasks.md
              → respawnWorker (one AI validation pass)
  ↓
useLoop: all tasks done → skip getStatus() check (state.validateOnComplete=true) → archiveChange
```

## Key Implementation Details

### Spec file indicator

The worker AI creates `openspec/changes/<name>/specs/validate.md` during the design phase when it determines the task needs a validation phase. This file is specific to the task and not part of any global configuration.

### State update on spec detection

When the spec file is first detected (after the worker exits), the wire layer updates the persisted state:

```typescript
stateData.validateOnComplete = true;
stateData.createPr = false;
```

This ensures subsequent worker spawns (for fix tasks, etc.) inherit the correct state: `buildTaskPrompt` omits the openspec-validate instruction, and `useLoop` skips the OpenSpec status check on archive.

### `runValidateOnlyPhase` signature (unchanged)

```typescript
export async function runValidateOnlyPhase(
  input: {
    changeName: string;
    cwd: string;
    changeDir: string;
    stateFilePath: string;
    validateCommands: string[];
  },
  deps: {
    cmd: CmdRunner;
    log: (text: string, color?: string) => void;
    emit: (phase: PostTaskPhase, detail?: string) => void;
    respawnWorker: () => Promise<number>;
  },
): Promise<number>;
```

### New `PostTaskPhase` values

- `"validate"` — running check commands or AI validation pass
- `"validate-fix"` — check command failed, prepending fix task

### Prompt changes (buildTaskPrompt, unchanged)

```typescript
const isValidateOnly = state.validateOnComplete && !state.createPr;
if (!isValidateOnly) {
  prompt += `Run \`bunx openspec validate ${state.name}\` before committing.\n`;
}
```

### Archive guard in useLoop (unchanged)

```typescript
const skipStatusCheck = currentState.validateOnComplete && !currentState.createPr;
if (!skipStatusCheck && typeof opts.changeStore.getStatus === "function") {
  // existing OpenSpec status check
}
```

## Edge Cases

| Scenario                                              | Behavior                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `specs/validate.md` exists + `createPrOnSuccess=true` | `wantPrBase=true` → `wantValidateOnly=false` → PR flow takes precedence                                 |
| No `specs/validate.md`                                | `wantValidateOnly=false` → existing PR/no-PR behavior unchanged                                         |
| No `validateCommands` configured                      | `validateCommands=[]` → skip to AI validation pass immediately                                          |
| Check command fails                                   | Prepend fix task, respawn, return worker exit code                                                      |
| Validation worker injects new fix tasks               | Normal loop iteration picks them up on next cycle; eventually archives                                  |
| Worker exits non-zero                                 | `wantValidateOnly && exitCode === 0` guard → validate phase skipped; error handling unchanged           |
| First spawn (spec not yet created)                    | Worker runs with `createPr=true`; creates spec during design; post-task updates state before next spawn |

## Test Plan

- **`apps/agent/src/__tests__/post-task-validate-only.test.ts`**: unit tests for `runValidateOnlyPhase` (unchanged)
- **`packages/core/src/__tests__/loop.test.ts`**: `buildTaskPrompt` with `state.validateOnComplete=true` (unchanged — tests state directly)
- **`apps/agent/src/__tests__/worker-validate-spec.test.ts`** (new): wire layer detects `specs/validate.md` and sets `wantValidateOnly=true`, updates state
