# Design for RLF-42

## Current state

- `apps/agent/src/components/AgentMode.tsx:1214-1224` — `SteeringField.onSubmit` calls `appendSteering(changeDir, message)` only; no worker kill.
- `apps/agent/src/agent/coordinator.ts:153-795` — `AgentCoordinator` manages workers. Each `ActiveWorker` (line 126) carries `kill: () => void` delegated from the wire layer's `Bun.spawn` handle.
- `apps/agent/src/agent/wire.ts:894-1020` — `spawnWorker` spawns a `bun ralph loop task ...` subprocess; `kill()` sends SIGTERM.
- The coordinator already re-attaches in-progress issues via `fetchInProgress` (`coordinator.ts:278-286`), but that path requires waiting for the next poll (10–30 s).
- Task-loop reference for the "abort current, restart with steering" pattern: `apps/loop/src/hooks/useLoop.ts:62-65` and `198-246` (AbortController-driven engine restart).

## Approach

Agent-mode workers are subprocesses, not in-process engine calls, so we cannot reuse the `AbortController` + `resumeSessionId` mechanic directly. Instead, mirror the _semantics_: kill the current worker subprocess (so its current engine iteration ends), then immediately respawn it as a `resume`-mode worker. The replacement worker's first iteration reads `steering.md`, which has already been updated, and the task loop's existing `buildTaskPrompt` injects it into the prompt.

### Coordinator change

Extend `ActiveWorker` (`coordinator.ts:126-135`) with an internal `restarting: boolean` flag (default `false`).

Add a public method to `AgentCoordinator`:

```ts
async restartWorker(changeName: string): Promise<boolean>
```

Behavior:

1. If `this.stopped`, return `false`.
2. Find the active `ActiveWorker` whose `changeName` matches. If none, return `false`.
3. Set `worker.restarting = true`, capture its `issue` and `mode`.
4. Call `worker.kill()` (SIGTERM).
5. The exit handler in `launchWorker` (`coordinator.ts:665-682`):
   - splices the worker from `this.workers` (unchanged).
   - When `worker.restarting === true`, it MUST skip `notifyExited` entirely and instead unshift `{ issue, mode: "resume" }` onto `this.queue` and call `spawnNext()`.
   - When `worker.restarting === false`, the existing behavior (notifyExited + spawnNext) is preserved.
6. Telemetry: `capture("agent_worker_restarted", { change_name, reason: "steering" })`.
7. Return `true`.

`ticketsStarted` cap: re-queueing as resume must not consume an additional ticket budget. Track this by checking `restarting` inside `launchWorker` before incrementing `ticketsStarted`. Implementation: pass an `isRestart` flag through the queue entry (extend `QueueEntry` with an optional `isRestart?: boolean`), or — simpler — decrement `ticketsStarted` in the exit handler when we observe `worker.restarting`. The simpler subtractive form is preferred to avoid touching `QueueEntry`.

The respawn does NOT need to re-apply `setInProgress` (the label is already there) and does NOT need to post a "started" comment (this is not a fresh pickup). The existing `mode === "resume"` path already skips both — no change needed.

### AgentMode integration

Hold the coordinator in a ref (already done as `coordRef`) and extend the `AgentModeCoordinator` structural interface (`AgentMode.tsx:15-23`) with:

```ts
restartWorker(changeName: string): Promise<boolean>;
```

`SteeringField.onSubmit` (`AgentMode.tsx:1214-1224`) becomes:

```ts
try {
  await appendSteering(join(tasksDir, w.changeName), message);
} catch (err) {
  /* existing red log + rethrow */
}
const coord = coordRef.current;
if (coord) {
  const restarted = await coord.restartWorker(w.changeName);
  if (!restarted) {
    appendLog(`  steering queued for ${w.changeName} — will apply on next iteration`, "gray");
  } else {
    appendLog(`  steering applied, restarting worker for ${w.changeName}`, "cyan");
  }
}
```

Order matters: append steering _before_ kill so the file is on disk before the replacement reads its first prompt. `appendSteeringMessage` writes synchronously via the storage layer, so the ordering is guaranteed once the `await` resolves.

### Edge cases

- **Worker not active** (focused change is queued or already exited): `restartWorker` returns `false`; AgentMode logs an info line and does not throw.
- **Steering append fails**: existing try/catch in `onSubmit` logs the failure and rethrows; no kill is attempted.
- **Coordinator stopped**: `restartWorker` short-circuits to `false`.
- **Race: worker exits naturally between kill schedule and the exit handler observing `restarting`**: `restarting` is set before `kill()`, so the exit handler always sees it.
- **Repeated steering on the same worker**: each submission triggers a fresh kill+respawn; the replacement worker's `restarting` defaults to `false` until/unless steered again.

### Files touched

- `apps/agent/src/agent/coordinator.ts` — add `restarting` flag on `ActiveWorker`, add `restartWorker`, modify the exit handler in `launchWorker`, adjust `ticketsStarted` accounting.
- `apps/agent/src/components/AgentMode.tsx` — extend `AgentModeCoordinator` interface, call `restartWorker` from `SteeringField.onSubmit`, add info-line logging.
- `apps/agent/src/__tests__/agent-mode-steering.test.tsx` — assert that `restartWorker` is called after `appendSteering` and that ordering is correct.
- New: `apps/agent/src/__tests__/coordinator-restart-worker.test.ts` — unit test the coordinator path (kill called, no notifyExited side-effects, resume re-spawn, false on unknown / stopped).

### Telemetry

`capture("agent_worker_restarted", { change_name, reason: "steering" })` inside `restartWorker` immediately before the kill.
