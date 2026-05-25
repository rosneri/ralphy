# usage-gate — stop loop on session usage limit

## ADDED Requirements

### Requirement: Claude agent MUST set rateLimited when result-error message indicates a usage or session limit

`claude.ts` MUST inspect every `result-error` FeedEvent emitted by the Claude CLI stream. If the event's `message` field matches any of the following patterns (case-insensitive):

- `out of session`
- `usage.*limit` (e.g. "usage limit exceeded", "usage limit reached")
- `over.*limit` (e.g. "over the limit")
- `context.*window.*exceed` (e.g. "context window exceeded")
- `context_window_exceeded`
- Any pattern already matched by the existing rate-limit text detector (`you've hit your limit`, `rate limit`, `too many requests`)

then `AgentRunResult.rateLimited` MUST be set to `true`.

The scripted test-double agent (`scripted.ts`) MUST mirror the same detection so engine-level tests cover this path.

#### Scenario: result-error with "out of session" phrase sets rateLimited

- **Given** the Claude CLI emits `{"type":"result","subtype":"error","result":"out of session tokens"}`
- **When** `claudeAgent.run()` processes the stream
- **Then** `AgentRunResult.rateLimited` is `true`
- **And** `AgentRunResult.exitCode` is `0` (the process was killed intentionally after the result event)

#### Scenario: result-error with "context window exceeded" sets rateLimited

- **Given** the Claude CLI emits `{"type":"result","subtype":"error","result":"context window exceeded the maximum"}`
- **When** `claudeAgent.run()` processes the stream
- **Then** `AgentRunResult.rateLimited` is `true`

#### Scenario: result-error without a limit phrase does not set rateLimited

- **Given** the Claude CLI emits `{"type":"result","subtype":"error","result":"tool call failed"}`
- **When** `claudeAgent.run()` processes the stream
- **Then** `AgentRunResult.rateLimited` is `false`

### Requirement: Loop MUST stop immediately when rateLimited is true even on clean exit (exit code 0)

`useLoop.ts` MUST add a guard between the non-zero exit handling block and the success path. When `engineResult.exitCode === 0` and `engineResult.rateLimited === true`, the loop MUST:

1. Log `"Usage limit reached — stopping loop."` via `addInfo`
2. Record the iteration as `"failed:rate-limited"` via `updateStateIteration`
3. Emit a `loop.engine_rate_limited` bus event with `exit_code: 0`
4. Set `finalStopReason = "rateLimited"` and break out of the loop

The loop MUST NOT start a new iteration after detecting `rateLimited === true` regardless of exit code.

#### Scenario: loop stops after usage-limit result-error on clean exit

- **Given** an iteration where Claude returns a usage-limit `result-error` (exit 0, rateLimited true)
- **When** `useLoop` processes the engine result
- **Then** the loop breaks with `finalStopReason = "rateLimited"`
- **And** no further iterations are started
- **And** `loop.engine_rate_limited` is emitted with `exit_code: 0`

#### Scenario: existing non-zero exit rateLimited check is not regressed

- **Given** an iteration where the engine exits with non-zero and `rateLimited` is true
- **When** `useLoop` processes the engine result
- **Then** the existing check inside the non-zero exit block still fires and the loop stops

## MODIFIED Requirements

### Requirement: Existing rate-limit detection for text events is preserved unchanged

The existing check (`event.type === "text" && isRateLimitText(event.text)`) in `claude.ts` MUST remain in place. The new `result-error` check is additive and MUST NOT replace the text-event check.

#### Scenario: rate-limit text in assistant message still sets rateLimited

- **Given** the Claude CLI emits an assistant text block containing "You've hit your limit"
- **When** `claudeAgent.run()` processes the stream
- **Then** `AgentRunResult.rateLimited` is `true`
