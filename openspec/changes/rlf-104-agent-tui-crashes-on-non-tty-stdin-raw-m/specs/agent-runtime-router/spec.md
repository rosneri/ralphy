# agent-runtime-router spec delta — RLF-104

## ADDED Requirements

### Requirement: The agent entrypoint MUST auto-fall-back to JSON output when stdin is not a TTY

The agent entrypoint (`apps/agent/src/index.ts`) MUST check `process.stdin.isTTY` before calling Ink's `render()`. When stdin is not a TTY (value is anything other than the literal `true`) and the user did not pass `--json-output`, the entrypoint MUST route execution through the existing JSON-output runner (`runAgentJson`) instead of mounting the Ink TUI, and MUST emit a single-line notice on stderr explaining the fallback.

When stdin IS a TTY, behavior MUST be unchanged — Ink renders normally.
When the user explicitly passes `--json-output`, no fallback notice MUST be emitted; the existing JSON path runs as today.

#### Scenario: Non-TTY stdin auto-falls-back to JSON mode

- **Given** `ralphy agent` is invoked with stdin piped (e.g. `... | tee out.log`)
- **And** `--json-output` is NOT passed
- **When** `main()` runs past argument parsing
- **Then** `runAgentJson` is invoked
- **And** Ink's `render()` is NOT called
- **And** a single line `agent: stdin is not a TTY — falling back to --json-output mode.` is written to stderr
- **And** the process does NOT crash with `Raw mode is not supported`

#### Scenario: TTY stdin renders the Ink TUI as before

- **Given** `ralphy agent` is invoked from an interactive terminal
- **When** `main()` reaches the render step
- **Then** Ink's `render()` is called with the `AgentMode` component
- **And** no fallback notice is written to stderr

#### Scenario: Explicit `--json-output` is silent

- **Given** `ralphy agent --json-output` is invoked (TTY or not)
- **When** `main()` runs
- **Then** `runAgentJson` is invoked
- **And** no fallback notice is written to stderr
