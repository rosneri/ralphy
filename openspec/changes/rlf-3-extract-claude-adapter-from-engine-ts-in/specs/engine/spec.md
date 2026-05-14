# Engine — Claude adapter extraction

## ADDED Requirements

### Requirement: Claude adapter lives in its own package

Claude-specific subprocess and stream-parsing logic SHALL live in
`packages/adapter-claude`, exposed as `runClaude`, `buildClaudeArgs`,
`isRateLimitText`, and `parseClaudeLine`.

#### Scenario: engine.ts delegates Claude runs to the adapter

- **WHEN** `runEngine` is called with `engine: "claude"` and a non-interactive
  prompt
- **THEN** it invokes `runClaude` from `@ralphy/adapter-claude` with the model,
  prompt, optional `resumeSessionId`, `cwd`, `logFile`, `signal`, and event
  emitter, and returns the adapter's `ClaudeResult` unchanged

#### Scenario: engine.ts no longer knows the stream-json transport

- **WHEN** `packages/engine/src/engine.ts` is inspected
- **THEN** it does not import from `formatters/claude-stream` and does not
  contain the strings `stream-json` or `--output-format`; the Claude CLI flag
  surface is owned entirely by `buildClaudeArgs` inside `@ralphy/adapter-claude`

### Requirement: Interactive Claude mode stays in the engine

Interactive Claude sessions (TTY passthrough via `runInteractive`) SHALL remain
in `packages/engine/src/engine.ts` and SHALL NOT route through the adapter.

#### Scenario: runEngine handles interactive mode locally

- **WHEN** `runEngine` is called with `interactive: true` and `engine: "claude"`
- **THEN** it calls the in-engine `runInteractive` helper (inherited stdio,
  prompt-file workflow) without invoking `runClaude`
