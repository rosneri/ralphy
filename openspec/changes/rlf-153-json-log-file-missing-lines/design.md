# Design for RLF-153

## Root Cause

`packages/log/src/log.ts` exposes `logJsonEvent(logFile, event)` which calls the module-level fire-and-forget `write()` helper:

```ts
function write(path: string, line: string): void {
  appendFile(path, line).catch(() => undefined);
}
```

There is no serialization across concurrent calls to the same path. The UI sidecar calls `broadcast()` (and thus `logJsonEvent`) very frequently — once per engine feed event — so many unordered `appendFile` promises are in flight simultaneously. On writes larger than `PIPE_BUF` (~4 KiB), the OS cannot guarantee atomicity of `O_APPEND` writes, so bytes interleave. Errors are also silently dropped.

The agent package already has the correct pattern in `apps/agent/src/agent/json-log/json-log-file.ts`: a per-file promise chain ensures all writes are serialized.

## Fix

### `packages/log/src/log.ts`

1. Add a module-level `Map<string, Promise<void>> jsonLogChains` to track the pending write chain per path.
2. Rewrite `logJsonEvent` to chain each write on `jsonLogChains.get(path)`, storing the new tail back:

```ts
const jsonLogChains = new Map<string, Promise<void>>();

export function logJsonEvent(logFile: string, event: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  const prev = jsonLogChains.get(logFile) ?? Promise.resolve();
  const next = prev.then(() => appendFile(logFile, line)).catch(() => undefined);
  jsonLogChains.set(logFile, next);
}
```

3. Add `flushJsonLog(logFile: string): Promise<void>` that returns `jsonLogChains.get(logFile) ?? Promise.resolve()`. Callers can await this before reading the file in tests or before process exit.

4. Clear the chain entry inside `initWorkerLog` (after truncating) so old chains from a previous run don't linger:

```ts
export async function initWorkerLog(logFile: string): Promise<void> {
  await mkdir(dirname(logFile), { recursive: true });
  await Bun.write(logFile, "");
  jsonLogChains.delete(logFile); // reset chain for fresh run
}
```

No changes needed to `apps/agent/src/agent/json-log/json-log-file.ts` — it already serializes writes correctly.
No changes needed to the sidecar `broadcast()` — `logJsonEvent` becomes safe to call fire-and-forget.

## Files to Touch

| File                                           | Change                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/log/src/log.ts`                      | Add chain map, rewrite `logJsonEvent`, add `flushJsonLog`, reset chain in `initWorkerLog` |
| `packages/log/src/index.ts` (if it exists)     | Export `flushJsonLog`                                                                     |
| `packages/log/src/__tests__/log.test.ts` (new) | Test that all rapid `logJsonEvent` calls appear in the file                               |

## Edge Cases

- **Chain accumulation**: The chain map holds a resolved promise after each write completes. This is fine — `.then()` on a resolved promise resolves immediately. The map never grows unboundedly because each path entry is a single tail promise, not a list.
- **initWorkerLog race**: Clearing the chain inside `initWorkerLog` (which is already awaited by the caller) ensures no stale chain interferes with the new run.
- **Error swallowing**: Errors continue to be swallowed (matching existing behavior) so logging failures never crash the loop.
