# Tasks for RLF-24

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-24/preserve-ui-state-on-terminal-resize and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [ ] Add `apps/loop/src/hooks/useTerminalSize.ts` — React hook that subscribes to `process.stdout` `"resize"`, returns `{ columns, rows, resizeKey }`, dedupes no-op size changes, and cleans up its listener on unmount. Skip listening when stdout is not a TTY.
- [ ] Update `apps/loop/src/components/TaskLoop.tsx`: consume `useTerminalSize`, on `resizeKey` change write `\x1b[2J\x1b[3J\x1b[H` to `useStdout().write(...)`, and apply `key={resizeKey}` to the root `<Box>` so Static + dynamic regions remount at the new size.
- [ ] Update `apps/loop/src/components/StatusBar.tsx`: replace the hard-coded `"─".repeat(52)` with a width derived from `useStdout().stdout.columns` (or `useTerminalSize`) — clamped to `[8, 52]`.
- [ ] Add `apps/loop/src/hooks/__tests__/useTerminalSize.test.ts` covering: initial size from stdout, listener attached on mount + removed on unmount, state updates when stdout emits `"resize"`, no-op resize does not bump `resizeKey`.
- [ ] Run `bun run lint` and fix any issues.
- [ ] Run `bun run test` and ensure the suite passes (no coverage threshold reduction).
- [ ] Run `bunx openspec validate rlf-24-preserve-ui-state-on-terminal-resize`.
- [ ] Stage modified files individually (`git add <path>`), commit, push branch, and open the PR with the change name as title and a concise summary.
