# Design for RLF-151: Support no-PR tasks with validate-only flow

## Files to Touch

| File                                        | Change                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workflow/src/schema.ts`           | Add `validateOnComplete: z.boolean().default(false)` to `WorkflowConfigSchema`                                                                                                                  |
| `packages/types/src/types.ts`               | Add `validateOnComplete: z.boolean().default(false)` to `StateSchema`                                                                                                                           |
| `packages/core/src/state.ts`                | Add `validateOnComplete?: boolean` to `BuildInitialStateOptions`; pass it through in `buildInitialState`                                                                                        |
| `packages/core/src/loop.ts`                 | Add `validateOnComplete?: boolean` to `LoopOptions`; update `buildTaskPrompt` to skip openspec-validate and PR instructions when `state.validateOnComplete && !state.createPr`                  |
| `apps/loop/src/cli.ts`                      | Add `--validate-on-complete` flag; add `validateOnComplete: boolean` to `ParsedArgs`                                                                                                            |
| `apps/loop/src/components/App.tsx`          | Pass `validateOnComplete: args.validateOnComplete`; change `createPr: args.fromAgent && !args.validateOnComplete`                                                                               |
| `apps/loop/src/hooks/useLoop.ts`            | Pass `validateOnComplete` from `LoopOptions` to `buildInitialState`; skip `getStatus()` check when `currentState.validateOnComplete && !currentState.createPr`                                  |
| `apps/agent/src/agent/post-task.ts`         | Add `"validate"` and `"validate-fix"` phases; add `wantValidateOnly?: boolean` to `PostTaskInput`; add `validateCommands?: string[]` to `cfg`; add `runValidateOnlyPhase`; update `runPostTask` |
| `apps/agent/src/agent/wire/spawn/worker.ts` | Derive `wantValidateOnly`; add `--validate-on-complete` to worker command; populate `cfg.validateCommands`                                                                                      |

## Data Flow

```
WORKFLOW.md (validateOnComplete: true)
  ↓
cfg.validateOnComplete = true
  ↓
wire: wantValidateOnly = cfg.validateOnComplete && !wantPrBase
  ↓
buildTaskCmdFor adds --validate-on-complete to worker CLI
  ↓
ParsedArgs.validateOnComplete = true
  ↓
App.tsx → LoopOptions.validateOnComplete = true, createPr = false
  ↓
buildInitialState → state.validateOnComplete = true, state.createPr = false
  ↓
buildTaskPrompt: omits openspec-validate and PR instructions
  ↓
(worker runs iterations until tasks.md all checked)
  ↓
runPostTask(wantValidateOnly=true, exitCode=0)
  → runValidateOnlyPhase(validateCommands=[...])
      step 1: run each validateCommand via cmd.run(["sh","-c",cmd], cwd)
        fail → prepend fix task → respawnWorker → return exit code
      step 2: prepend "## Validate: verify your work is complete" to agent-tasks.md
              → respawnWorker (one AI validation pass)
  ↓
useLoop: all tasks done → skip getStatus() check → archiveChange
```

## Key Implementation Details

### `runValidateOnlyPhase` signature

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

Internally it uses `runCapability(fsChange.prependTask, ...)` and `reactivateState(...)` directly, mirroring the body of `runWorkerWithFixTask` without requiring the full `PostTaskCtx`.

### New `PostTaskPhase` values

- `"validate"` — running check commands or AI validation pass
- `"validate-fix"` — check command failed, prepending fix task

### Wire layer

```typescript
const wantValidateOnly = cfg.validateOnComplete && !wantPrBase;
// passed to PostTaskInput.wantValidateOnly
// and --validate-on-complete appended to buildTaskCmdFor output when true
// and cfg: { ..., validateCommands: [test, lint, typecheck].filter(Boolean) }
```

### Prompt changes (buildTaskPrompt)

```typescript
// Existing (only when createPr)
if (state.createPr) {
  prompt += `\nWhen all tasks are complete...push...gh pr create...\n`;
}

// Existing unconditional — skip when validate-only
const isValidateOnly = state.validateOnComplete && !state.createPr;
if (!isValidateOnly) {
  prompt += `Run \`bunx openspec validate ${state.name}\` before committing.\n`;
}
```

### Archive guard in useLoop

```typescript
const skipStatusCheck = currentState.validateOnComplete && !currentState.createPr;
if (!skipStatusCheck && typeof opts.changeStore.getStatus === "function") {
  // existing OpenSpec status check
}
```

## Edge Cases

| Scenario                                               | Behavior                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `validateOnComplete=true` + `createPrOnSuccess=true`   | `wantPrBase=true` → `wantValidateOnly=false` → PR flow takes precedence; validate-only not triggered |
| `validateOnComplete=false` + `createPrOnSuccess=false` | Existing no-PR, no-validate behavior preserved                                                       |
| No `validateCommands` configured                       | `validateCommands=[]` → skip to AI validation pass immediately                                       |
| Check command fails                                    | `runWorkerWithFixTask`-style: prepend fix task, respawn, return worker exit code                     |
| Validation worker injects new fix tasks                | Normal loop iteration picks them up on next cycle; eventually archives                               |
| Worker exits non-zero                                  | `wantValidateOnly && exitCode === 0` guard → validate phase skipped; error handling unchanged        |

## Test Plan

- **`apps/agent/src/__tests__/post-task-validate-only.test.ts`** (new): unit tests for `runValidateOnlyPhase`
  - checks pass → validation task injected → worker respawned
  - first check fails → fix task injected → worker respawned
  - no commands → goes straight to validation pass
- **`packages/core/src/__tests__/loop.test.ts`** (update): test `buildTaskPrompt` with `validateOnComplete=true, createPr=false` — confirm openspec-validate and PR instructions are absent
- **`packages/workflow/src/__tests__/schema.test.ts`** or existing schema tests: verify `validateOnComplete` defaults to false and parses correctly
