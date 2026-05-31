# Design for RLF-198

## Overview

The preemption protocol currently lives in `apps/agent/src/runtime/flow-runner.ts::preempt()` as a standalone async function. The `flowMachine` in `packages/core/src/machines/flow.machine.ts` has no knowledge of preemption. This change adds a `preempting` state to the machine backed by an injectable `fromPromise` actor so the coordinator can trigger preemption via an XState event.

---

## Files to Touch

| File                                                           | Change                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/machines/flow.machine.ts`                   | Add `FlowContext`, `PREEMPT` + `WORKER_SPAWNED` events, `preempting` state, invoked actor, post-preemption routing |
| `packages/core/src/machines/flow-actor-store.ts`               | Accept `input` at actor creation; forward `issueId` + deps so context is populated on startup                      |
| `packages/core/src/machines/index.ts`                          | Re-export new types                                                                                                |
| `apps/agent/src/runtime/flow-runner.ts`                        | Export `FlowContext`, `PreemptActorInput` types; keep `preempt()` as the actor logic implementation                |
| `apps/agent/src/runtime/coordinator.ts`                        | Send `WORKER_SPAWNED` on spawn; send `PREEMPT` when a flow change is required                                      |
| `apps/agent/src/runtime/__tests__/flow-runner-preempt.test.ts` | Port tests to drive the machine state machine via fake workers                                                     |
| `packages/core/src/machines/__tests__/flow.machine.test.ts`    | Add unit tests for PREEMPT transitions, no-worker path, post-preemption routing                                    |

---

## Data Flow

### Context shape added to `flowMachine`

```typescript
type FlowContext = {
  // Populated at actor creation via `input`
  issueId: string;
  bus: Bus;
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  graceMs: number; // default 5000

  // Updated via WORKER_SPAWNED event
  worker?: FlowWorker;
  teardown?: Teardown;
  currentAssignment?: FlowAssignment;

  // Set by PREEMPT event, cleared after preemption completes
  pendingAssignment?: FlowAssignment;
};
```

### New events

```typescript
| { type: "WORKER_SPAWNED"; worker: FlowWorker; teardown?: Teardown; assignment: FlowAssignment }
| { type: "PREEMPT"; newAssignment: FlowAssignment }
```

### State transitions added

```
working        --[PREEMPT]--> preempting
conflict-fix   --[PREEMPT]--> preempting
ci-fix         --[PREEMPT]--> preempting
awaiting       --[PREEMPT]--> preempting   (no-worker path: skips SIGTERM/SIGKILL)
```

On `WORKER_SPAWNED` (in any worker-bearing state), the machine assigns `context.worker`, `context.teardown`, and `context.currentAssignment`.

### Preempting state (invoked actor)

```typescript
preempting: {
  invoke: {
    src: "preemption",
    input: ({ context }) => ({
      worker: context.worker,          // undefined → no-worker path
      graceMs: context.graceMs,
      bus: context.bus,
      persist: context.persist,
      issueId: context.issueId,
      from: context.currentAssignment?.flowId,
      newAssignment: context.pendingAssignment!,
      teardown: context.teardown,
    }),
    onDone: {
      actions: assign({ worker: undefined, teardown: undefined, currentAssignment: ({ context }) => context.pendingAssignment }),
      target: "routing-after-preempt",
    },
    onError: "error",
  },
}
```

### Post-preemption routing

A transient `routing-after-preempt` state (or guards on `onDone` targets) maps `pendingAssignment.flowId` to the correct machine state:

| `pendingAssignment.flowId`                                                     | Target state   |
| ------------------------------------------------------------------------------ | -------------- |
| `"implement"` / `"new-ticket"` / `"mention"` / `"stuck"` / `"review-followup"` | `working`      |
| `"conflict-fix"`                                                               | `conflict-fix` |
| `"ci-fix"`                                                                     | `ci-fix`       |
| `"awaiting-ci"`                                                                | `awaiting`     |
| `"confirmation"`                                                               | `awaiting`     |
| `"review-followup"`                                                            | `review`       |
| `"idle"`                                                                       | `idle`         |

### Preemption actor logic (injectable)

The `preemption` actor key is declared in `setup({ actors: { preemption: ... } })`. The concrete `fromPromise` implementation is provided:

- In production: via `flowMachine.provide({ actors: { preemption: preemptionActorLogic } })` in the coordinator (or `FlowActorStore`).
- In tests: replaced with a fake actor via `provide()`.

The actor logic is identical to the current `preempt()` function body, but extracted into `fromPromise`:

```typescript
export const preemptionActorLogic = fromPromise(async ({ input }: { input: PreemptActorInput }) => {
  // same 8 steps as preempt() today
  // if input.worker is undefined, skip SIGTERM/SIGKILL steps (no-worker path)
});
```

### No-worker path

When `context.worker` is undefined (e.g., machine is in `awaiting` state with no active subprocess):

1. Emit `runtime.preempt.started`
2. Skip SIGTERM/SIGKILL
3. Call `teardown('cancelled')` if present
4. Persist new assignment
5. Emit `runtime.preempt.completed`

The `requiresWorker()` check no longer needs to happen externally — the actor logic branches on `input.worker !== undefined`.

---

## FlowActorStore changes

`getActor` currently calls `createActor(flowMachine)` with no input. After this change it will call `createActor(flowMachineWithImpl, { input: { issueId, bus, persist, graceMs } })`.

`FlowActorStore` will receive a `FlowActorDeps` object at construction time (or `getActor` will accept it as a new parameter). The `flowMachineWithImpl` is the result of `flowMachine.provide({ actors: { preemption: preemptionActorLogic } })`.

---

## Coordinator changes

Two new coordinator-side operations:

1. **On worker spawn** (after `Bun.spawn` returns): `actor.send({ type: "WORKER_SPAWNED", worker, teardown, assignment })`
2. **On preemption trigger** (when coordinator detects a flow change is needed while a worker is running): `actor.send({ type: "PREEMPT", newAssignment })` — replaces any future call to `preempt()`.

The coordinator must also subscribe to the flow actor's `preempting` → completion transition to know when it can spawn the next worker (i.e., not spawn the new worker until the machine exits `preempting`).

---

## Edge Cases

1. **Worker already dead when PREEMPT fires** — `worker.kill()` throws; the preemption actor already wraps both kill calls in try/catch, so the actor resolves normally.
2. **SIGKILL also throws** — handled by the existing try/catch in the actor logic; `worker.exited` is still awaited after the throw.
3. **Teardown throws** — swallowed; preemption must not be blocked by teardown errors.
4. **PREEMPT fires from `awaiting` (no worker)** — `input.worker` is `undefined`; the actor skips the kill steps and goes directly to teardown → persist → emit.
5. **Snapshot rehydration with pending preemption** — if the machine is snapshotted mid-`preempting`, on restore it re-enters `preempting` and re-runs the actor. The coordinator must register fresh worker handles (or the no-worker path applies since `context.worker` won't survive serialisation). The actor should be resilient when `worker` is `undefined` — treat as no-worker.
6. **Multiple PREEMPT events queued** — the machine only processes one at a time; while in `preempting`, additional PREEMPT events are queued by XState and processed after the state exits. The `pendingAssignment` may be overwritten; guard or buffer if needed.
7. **graceMs default** — `FlowActorStore` passes `5000` unless the caller overrides; tests pass a small value (e.g., `20`) via input.

---

## Test Strategy

- **Unit tests in `packages/core`** — drive the machine with fake workers (no real processes), verify state snapshot, event order, context mutations. No real sleeps (inject tiny `graceMs`).
- **Ported integration tests** — the four existing `flow-runner-preempt.test.ts` scenarios rewritten as machine-level tests: same event-ordering assertions, same teardown/persist verifications.
- **No-worker tests** — machine in `awaiting` state + `PREEMPT` → exits without calling `kill`.
- **Post-preemption routing tests** — after preemption completes, `machine.getSnapshot().value` equals the expected state for each `flowId`.
