# Design for RLF-149

## Problem

Two distinct failure modes cause PR mergeability to remain stuck as `"unknown"`:

### 1. Transient errors abort the retry loop (`pr-discovery.ts`)

`checkPrStatus` retries `gh pr view` up to 3 times (2 s apart) when it returns
`UNKNOWN`. But the catch block inside the loop called `return { url, status: "unknown" }`
immediately — so a single HTTP 502 skipped all remaining retry attempts.

### 2. Single fetch after conflict-fix rebase (`post-task.ts`)

After a conflict-fix worker rebases and pushes, `runPostTask` called `fetchPrStatus`
exactly once. GitHub needs a few seconds to recompute mergeability after a push,
so the result is often `UNKNOWN`, leaving the conflict label in place until the
next full poll cycle.

## Fix

### `apps/agent/src/agent/wire/pr-discovery.ts` — lines 133-136

Remove the `return` from the catch block. `m` stays `undefined`, so the
`if (m && m !== "UNKNOWN")` guard fails, the loop sleeps 2 s, and the next
attempt runs. After all 3 attempts the existing fallback (`return { url, status: "unknown" }`)
fires as before.

Log message updated to show attempt number so failures are easier to diagnose.

### `apps/agent/src/agent/post-task.ts` — conflict-fix verify path (~line 1115)

Add a retry loop:

```
let status = await fetchPrStatus(prUrl, cmd, cwd);
for (let attempt = 0; attempt < 3 && status.kind === "ok" && status.mergeable === "UNKNOWN"; attempt++) {
  await sleep(unknownDelayMs);     // default 2000 ms; 0 in tests
  status = await fetchPrStatus(prUrl, cmd, cwd);
}
// existing MERGEABLE / CONFLICTING / UNKNOWN / error branches
```

`unknownDelayMs` comes from `deps._mergeabilityUnknownRetryDelayMs ?? 2000` so
tests can pass 0 and stay fast.

### `apps/agent/src/__tests__/post-task-conflict-fix.test.ts`

- Extend `MakeCmdOpts.prView` to accept an array (`PrViewSpec[]`) for per-call
  response sequences. A `viewCallIdx` counter advances each time `gh pr view` is
  called; the last entry in the array repeats once exhausted.
- Rename "UNKNOWN" test to clarify it covers the persistent-UNKNOWN case and
  assert exactly 4 `gh pr view` calls (1 + 3 retries).
- Add "UNKNOWN → MERGEABLE after retries" test: mock returns `[UNKNOWN, UNKNOWN,
MERGEABLE]`; assert `clearConflicted` is called and log is green.

## Files touched

| File                                                      | Change                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/agent/src/agent/wire/pr-discovery.ts`               | Remove immediate return on error in retry loop                  |
| `apps/agent/src/agent/post-task.ts`                       | Add UNKNOWN retry loop + `_mergeabilityUnknownRetryDelayMs` dep |
| `apps/agent/src/__tests__/post-task-conflict-fix.test.ts` | New tests + extended mock                                       |

## Edge cases

- **Error on every attempt**: after 3 errors, `mergeable` stays `null` → returns
  `status: "unknown"`, coordinator rechecks next poll. No change in eventual
  behaviour.
- **CONFLICTING on retry**: loop exits immediately (condition fails), falls
  through to the CONFLICTING branch.
- **`status.kind === "error"` on retry**: loop condition requires `status.kind === "ok"`,
  so errors exit the loop and fall through to the existing error branch.
