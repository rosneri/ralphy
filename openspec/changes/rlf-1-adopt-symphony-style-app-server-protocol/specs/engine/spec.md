# Engine Capability — Agent Boundary

## ADDED Requirements

### Requirement: Engine dispatches through a registered agent adapter

The engine MUST run agents via an `Agent` adapter looked up from a
registry keyed by the public `Engine` name. Agent-specific wire format
knowledge (CLI args, stream parsing, kill-on-result semantics) MUST live
in the adapter, not in `runEngine`.

#### Scenario: Claude engine dispatches to the claude adapter

- **WHEN** `runEngine` is called with `engine: "claude"`
- **THEN** the claude adapter is invoked with an `AgentRequest`
- **AND** the adapter spawns the `claude` CLI with stream-json output
- **AND** the adapter returns an `AgentRunResult` with `exitCode`,
  `usage`, `sessionId`, and `rateLimited`

#### Scenario: Codex engine dispatches to the codex adapter

- **WHEN** `runEngine` is called with `engine: "codex"`
- **THEN** the codex adapter is invoked with an `AgentRequest`
- **AND** the adapter spawns the `codex` CLI with JSON output and
  drains both stdout and stderr
- **AND** the adapter returns an `AgentRunResult` whose `rateLimited`
  reflects any rate-limit message seen in the stream

### Requirement: Agent adapters emit FeedEvents via onFeedEvent

Adapters MUST translate their CLI's native stream into the shared
`FeedEvent` vocabulary and deliver every event via the
`onFeedEvent` callback on `AgentRequest`. Adapters MUST NOT print
directly to stdout.

#### Scenario: Adapter forwards parsed feed events to the caller

- **WHEN** an adapter receives a parseable line from its CLI
- **THEN** every `FeedEvent` produced by the parser is passed to
  `onFeedEvent`
- **AND** raw protocol lines are passed to `onRawLine` when the
  caller supplied one (for log-file capture)
