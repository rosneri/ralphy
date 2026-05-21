# RLF-104: Agent TUI crashes on non-TTY stdin — "Raw mode is not supported"

Source: [RLF-104](https://linear.app/neriros/issue/RLF-104/agent-tui-crashes-on-non-tty-stdin-raw-mode-is-not-supported)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Why

Running `ralphy agent` with stdin detached from a TTY (pipe to `tee`, `nohup`, CI runner, background job) crashes immediately with:

```
ERROR Raw mode is not supported on the current process.stdin, which Ink uses
      as input stream by default.
```

The agent never reaches its polling loop — it dies before doing any work. The only workaround today is to know about the undocumented `--json-output` flag.

The TUI requires raw-mode stdin for keybindings, but raw mode is unavailable when stdin is a pipe. The runtime should detect this at startup and pick a stdin-safe mode instead of crashing.

## What Changes

- In `apps/agent/src/index.ts`, before calling `render()`, detect non-TTY stdin (`process.stdin.isTTY !== true`).
- When stdin is not a TTY and `--json-output` was not explicitly set, auto-route through the existing `runAgentJson` non-TUI runner and emit a one-line stderr notice explaining the fallback.
- Document the behavior in `--help` so users know piping is supported.
- Add a regression test in `apps/agent/src/__tests__/` that drives `main()` with a non-TTY stdin and asserts the json-runner path is taken (no Ink render, no crash).

### Acceptance Criteria

- `bun run ralphy agent ... 2>&1 | tee out.log` no longer exits 1 with the Ink raw-mode error.
- When stdin is a TTY, behavior is unchanged (Ink TUI renders).
- When stdin is not a TTY, the agent runs in JSON-output mode and prints a stderr line like `agent: stdin is not a TTY — falling back to --json-output mode.`
- Explicit `--json-output` still works and emits no fallback notice.
- `bun run lint` and `bun run test` pass.

## Additional instructions

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
