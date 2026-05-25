# Tasks for RLF-85

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-85/run-agent-mode-in-tmux-and-reconnect-on-re-entry and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Create `apps/agent/src/runtime/tmux.ts` with exported functions: `tmuxAvailable`, `sessionName`, `sessionExists`, `isInsideTmux`, `getSessionStatus`, `createSession`, `attachSession`, `switchClientToSession`, `killSession`
- [x] Modify `apps/agent/src/cli.ts`: add `"stop" | "status"` to `AgentMode` union, add `noTmux: boolean` to `ParsedArgs`, parse `--no-tmux` flag and `stop`/`status` subcommands, update HELP_TEXT
- [x] Modify `apps/agent/src/index.ts`: add `maybeRunViaTmux` function that checks tmux availability and creates/attaches to the managed session; handle `stop` and `status` modes; skip tmux logic when `jsonOutput`, `noTmux`, or `RALPH_AGENT_MANAGED` is set
- [x] Write `apps/agent/src/__tests__/tmux.test.ts` covering: `sessionName` derivation, `RALPH_SESSION_NAME` override, `sessionExists` parsing, `getSessionStatus` attached/detached parsing, race-condition duplicate-session error handling in `createSession`
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and fix any failures
