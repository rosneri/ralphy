# Design for RLF-1

## Goal

Decouple `packages/engine/src/engine.ts` from agent-specific wire formats
by introducing an internal `Agent` adapter protocol. The protocol is the
boundary between the loop driver (`engine.ts`) and per-agent code that
knows how to spawn a CLI, parse its stream, and translate it into the
shared `FeedEvent` vocabulary.

## Protocol

Defined in `packages/engine/src/agents/protocol.ts`.

```ts
interface AgentRequest {
  model: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  resumeSessionId?: string;
  interactive?: boolean;
  taskDir?: string;
  onFeedEvent: (event: FeedEvent) => void;
  onRawLine?: (line: string) => void;
}

interface AgentRunResult {
  exitCode: number;
  usage: IterationUsage | null;
  sessionId: string | null;
  rateLimited: boolean;
}

interface Agent {
  readonly name: Engine;
  run(req: AgentRequest): Promise<AgentRunResult>;
}
```

`FeedEvent` is the existing structured-event vocabulary already shared
between formatters and the TUI — that's the "AgentEvent" half of the
contract. `AgentRequest` is the "AgentRequest" half.

## Adapters

- `agents/claude.ts` — spawns `claude` with stream-json, parses via
  `parseClaudeLine`, kills the process after the first `result` event,
  detects rate-limit text. Owns the interactive (`-p`/TTY passthrough)
  variant too.
- `agents/codex.ts` — spawns `codex exec --json`, drains stdout and
  stderr, parses via `parseCodexLine`.

Adapters call `spawn` directly. Tests mock `../spawn` exactly as before;
the existing engine tests continue to work because `runEngine` dispatches
through the adapter and the adapter still uses the mocked module.

## engine.ts

`runEngine` becomes a thin dispatcher:

1. Look up `AGENTS[opts.engine]`.
2. Wrap `onFeedEvent` so callers without one fall back to
   `renderFeedEvent` (preserves existing behavior).
3. Wrap `onRawLine` to append to `logFile` when `logFlag` is set.
4. Call `agent.run(request)` and return its `AgentRunResult`.

`handleEngineFailure` stays in `engine.ts` — it's about the loop's
reaction to an exit code, not about how the agent was driven.

## Why in-process

The proposal explicitly says: "Run adapters in-process initially;
promote to subprocess only if/when third-party adapters are needed."
A subprocess transport can be added later as a third adapter that
satisfies the same `Agent` interface — no change to `engine.ts`.

## Non-goals

- Wire-format stability across processes (no JSON serialization of
  `AgentRequest` / `AgentEvent` yet — that's deferred to whenever a
  third-party adapter actually exists).
- Replacing `parseClaudeLine` / `parseCodexLine`. Those keep doing the
  agent-specific decoding; the adapter is just the seam.
