# Design for RLF-104

## Problem

`apps/agent/src/index.ts:57` unconditionally calls Ink's `render()` for the agent mode. Ink attaches to `process.stdin` and enables raw mode for keybindings. If stdin is not a TTY (pipe, nohup, CI), Ink throws "Raw mode is not supported" before the agent does any work.

## Approach

Auto-fall-back to the existing JSON-output runner (`apps/agent/src/agent/json-runner.ts`) when stdin is not a TTY. This path already exists, handles the full agent lifecycle without Ink, and is the documented escape hatch — we just make it the default for non-TTY stdin.

Rationale for fallback (vs. running Ink with `stdin: createReadStream("/dev/null")`):

- The non-TTY case is exactly the case where keybindings and the live dashboard are useless (output is being captured/piped).
- `runAgentJson` is already the supported non-interactive path; reusing it keeps one code path for "headless" runs instead of inventing a third mode.
- A keystroke-less Ink render still produces ANSI redraws that pollute piped logs.

## Files Touched

- `apps/agent/src/index.ts` — add non-TTY check between args parse and `render()`. If `!process.stdin.isTTY && !args.jsonOutput`, write a stderr notice and call `runAgentJson` instead.
- `apps/agent/src/cli.ts` — extend `printHelp()` to document that the agent auto-switches to JSON output when stdin is not a TTY.
- `apps/agent/src/__tests__/non-tty-fallback.test.ts` — new test that overrides `process.stdin.isTTY` to `undefined`, invokes `main()` with a stub args path, and asserts `runAgentJson` is invoked (mock the dynamic import) and `render` from `ink` is not.

## Detection Logic

```ts
const stdinIsTty = process.stdin.isTTY === true;
if (!args.jsonOutput && !stdinIsTty) {
  process.stderr.write("agent: stdin is not a TTY — falling back to --json-output mode.\n");
  args = { ...args, jsonOutput: true };
}
```

We mutate the `args` shape (or re-assign) so the existing `if (args.jsonOutput)` branch on line 50 fires naturally. No new code paths.

## Edge Cases

- `args.mode === "list"` already runs before the render call and doesn't touch Ink — unchanged.
- Explicit `--json-output` from the user: `args.jsonOutput` is already true, the fallback notice is skipped, behavior identical to today.
- `process.stdin.isTTY` is `undefined` (not `false`) when stdin is a pipe — the strict `=== true` check handles both `undefined` and `false`.
- Tests mocking `ink` should not be required; the regression test asserts on which dynamic import path is taken.

## Test Strategy

One regression test asserting non-TTY → JSON runner. Mock `runAgentJson` and assert it's called; assert `render` is not called by stubbing the `ink` import via `mock.module`. Use `bun:test`'s lifecycle to restore `process.stdin.isTTY`.
