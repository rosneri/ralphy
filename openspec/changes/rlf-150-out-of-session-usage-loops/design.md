# Design for RLF-150: Out of session usage loops

## Problem

When Claude hits its session usage limit the Claude CLI emits:

```json
{ "type": "result", "subtype": "error", "result": "<error message about usage limit>" }
```

`parseClaudeLine` (in `claude-stream.ts`) handles this by setting `state.gotResult = true` and emitting a `result-error` FeedEvent. Back in `claude.ts`, `gotResult = true` triggers an intentional kill of the subprocess. Because the kill is intentional (SIGTERM/SIGKILL), the raw exit code is normalized to 0. `AgentRunResult` returns `{ exitCode: 0, rateLimited: false }`.

In `useLoop.ts`, the only place `rateLimited` is checked is inside the `if (engineResult.exitCode !== 0)` block. So a `rateLimited` flag set while exit code is 0 is silently dropped, the iteration is recorded as "success", and the next iteration starts.

## Fix

### Part 1 — Detect usage-limit errors in result-error events

**File:** `packages/engine/src/agents/claude.ts`

Add a `SESSION_LIMIT_PATTERNS` array and an `isResultErrorLimitText()` function. In the event-processing loop, when `event.type === "result-error"`, check its `message` against both the existing `RATE_LIMIT_PATTERNS` and the new `SESSION_LIMIT_PATTERNS`. If matched, set `detectedRateLimit = true`.

```
SESSION_LIMIT_PATTERNS = [
  /out of session/i,
  /usage.*limit/i,
  /over.*limit/i,
  /context.*window.*exceed/i,
  /context_window_exceeded/i,
]
```

**File:** `packages/engine/src/agents/scripted.ts`

Mirror the same patterns and detection in the scripted test-double agent (it duplicates the rate-limit pattern list for engine-level tests).

### Part 2 — Guard in the loop for exit-0 + rateLimited

**File:** `apps/loop/src/hooks/useLoop.ts`

After the `if (engineResult.exitCode !== 0)` block (which always ends with `continue` or `break`) and before the success path, add:

```typescript
if (engineResult.rateLimited) {
  addInfo("Usage limit reached — stopping loop.");
  updateStateIteration(
    stateDir,
    "failed:rate-limited",
    iterStart,
    opts.engine,
    opts.model,
    engineResult.usage,
  );
  getProcessBus().emit({ type: "loop.engine_rate_limited", exit_code: 0, iteration: iter });
  finalStopReason = "rateLimited";
  break;
}
```

This guard fires only when `exitCode === 0` (otherwise the `continue`/`break` in the non-zero block would have already handled it) and `rateLimited === true`.

## Data Flow

```
Claude CLI stdout
  → parseClaudeLine()         (claude-stream.ts)
    → result event, subtype=error, result="out of session..."
    → emits { type: "result-error", message: "out of session..." }
    → sets state.gotResult = true
  → claude.ts event loop
    → event.type === "result-error" → isResultErrorLimitText(event.message) → true
    → detectedRateLimit = true
    → process killed (intentional) → exit 0
  → AgentRunResult { exitCode: 0, rateLimited: true }
  → runEngine() returns EngineResult { exitCode: 0, rateLimited: true }
  → useLoop.ts
    → exitCode !== 0? NO — skip failure block
    → rateLimited? YES → addInfo + updateStateIteration + emit + break
    → loop stops with finalStopReason = "rateLimited"
```

## Edge Cases

- **Normal result-error (not a limit):** e.g., "tool call failed" — doesn't match patterns, `rateLimited` stays false, consecutive failure counter kicks in as before.
- **Rate-limit in text block:** existing detection (`event.type === "text"`) is unchanged.
- **Non-zero exit + rateLimited:** existing check inside the `exitCode !== 0` block already handles this — the new guard is never reached for non-zero exits.
- **Context window exceeded vs billing limit:** both are surfaced via `result-error`, so both are caught by the same detection logic.

## Files to Touch

| File                                                    | Change                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/engine/src/agents/claude.ts`                  | Add `SESSION_LIMIT_PATTERNS`, `isResultErrorLimitText()`, check result-error events |
| `packages/engine/src/agents/scripted.ts`                | Mirror detection for test-double parity                                             |
| `apps/loop/src/hooks/useLoop.ts`                        | Add exit-0 + rateLimited guard                                                      |
| `packages/engine/src/__tests__/agents.test.ts`          | Tests for result-error usage limit detection in claudeAgent                         |
| `packages/engine/src/__tests__/engine.test.ts`          | Tests for engine-level result-error detection via scripted agent                    |
| `apps/loop/src/hooks/__tests__/useLoop.test.ts`         | Structural assertion that guard is present                                          |
| `openspec/changes/rlf-150-.../specs/usage-gate/spec.md` | Spec delta                                                                          |
