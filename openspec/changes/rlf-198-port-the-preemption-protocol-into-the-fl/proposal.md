# RLF-198: Port the preemption protocol into the flow machine

Source: [RLF-198](https://linear.app/neriros/issue/RLF-198/port-the-preemption-protocol-into-the-flow-machine)
Status: Done
Labels: auto-merge

## Why

The preemption protocol is implemented as a standalone async function (`preempt()`) in `apps/agent/src/runtime/flow-runner.ts`, but it is not wired into the coordinator and the flow machine has no `preempting` state. This means:

- The coordinator has no declarative model of what is happening during preemption — the in-flight kill/wait/teardown sequence is invisible to the machine.
- The flow machine snapshot cannot represent "currently preempting" so dashboards and state logs are blind to it.
- Injecting test doubles requires threading fake dependencies through a standalone function call rather than through XState's native actor injection (`provide()`).

Porting the protocol into the machine gives us: an observable `preempting` state in actor snapshots, `graceMs`-injectable actors that need no real sleeps in tests, and a single coordinator entry point (`PREEMPT` event) that replaces the ad-hoc `preempt()` call.

## Goal

Move the preemption protocol from `runtime/flow-runner.ts::preempt` into the machine as explicit transitions/actors.

## Change

- Model the 8-step protocol as machine states/actions: emit `runtime.preempt.started` → SIGTERM → wait `graceMs` (default 5000) → SIGKILL if alive → await exit → `teardown('cancelled')` → persist new assignment → emit `runtime.preempt.completed`.
- Worker handle (`FlowWorker`: `exited`, `kill`) becomes an invoked actor; `graceMs` injectable for tests (no real sleeps).
- Preserve `requiresWorker` / no-worker (`awaiting-ci`) handling.

## What Changes

- `flowMachine` gains a `preempting` state with an invoked `fromPromise` actor that runs the 8-step protocol.
- `flowMachine` gains a `FlowContext` type holding `worker`, `graceMs`, `bus`, `persist`, `teardown`, `issueId`, `currentAssignment`, and `pendingAssignment`.
- Two new events added: `PREEMPT` (carries `newAssignment`) and `WORKER_SPAWNED` (carries `worker` and `teardown`).
- All worker-bearing states (`working`, `conflict-fix`, `ci-fix`) accept `PREEMPT` → enter `preempting`; the `awaiting` state accepts `PREEMPT` → enters a no-worker `preempting` path that skips SIGTERM/SIGKILL.
- After `preempting` completes, the machine transitions to the state that corresponds to the new assignment's `flowId`.
- `FlowActorStore` is updated to accept and forward `input` (issueId, deps) at actor creation time.
- The coordinator sends `WORKER_SPAWNED` when it spawns a subprocess and sends `PREEMPT` when it needs to change flows, replacing the currently-unwired standalone `preempt()` call.
- Existing `flow-runner-preempt.test.ts` tests are ported to drive the machine with a fake worker handle, verifying state transitions and event ordering.

## Acceptance Criteria

- `flowMachine` snapshot enters `preempting` state when `PREEMPT` event fires from a worker-bearing state.
- SIGTERM → SIGKILL escalation fires when the worker ignores SIGTERM and `graceMs` elapses — verified by machine-driven test.
- Graceful SIGTERM exit skips SIGKILL — verified by machine-driven test.
- `runtime.preempt.started` is emitted before any signal, `runtime.preempt.completed` is emitted last.
- `teardown('cancelled')` is called before persist.
- `awaiting` → `PREEMPT` transitions without touching a worker.
- After preemption, machine state matches the new assignment's `flowId`.
- `graceMs` is injectable so no test sleeps more than a few milliseconds.
- `bun run test` passes across all affected packages.
- `bun run lint` passes.

## Verify

- Port the existing flow-runner preemption tests to drive the machine with a fake worker handle; SIGTERM→SIGKILL escalation and event ordering match today's behavior.

## Additional instructions

You are working on RLF-198: Port the preemption protocol into the flow machine.

Labels: auto-merge

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
