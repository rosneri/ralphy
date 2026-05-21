# Tasks for RLF-104

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-104/agent-tui-crashes-on-non-tty-stdin-raw-mode-is-not-supported and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] In `apps/agent/src/index.ts`, after `parseArgs` and before `render()`, detect `process.stdin.isTTY !== true`; when true and `args.jsonOutput` is false, write the stderr fallback notice and set `args.jsonOutput = true` so the existing JSON branch handles it.
- [ ] Update `printHelp()` in `apps/agent/src/cli.ts` to document that the agent auto-switches to JSON output mode when stdin is not a TTY.
- [ ] Add a regression test `apps/agent/src/__tests__/non-tty-fallback.test.ts` that overrides `process.stdin.isTTY` to `undefined`, stubs `runAgentJson`, invokes `main()`, and asserts the JSON runner is called and the stderr fallback notice is emitted.
- [ ] Add a TTY-path test (or extend an existing one) that asserts when `process.stdin.isTTY === true` and `--json-output` is not passed, the Ink render path is reached (mock `render` from `ink` to capture the call without actually mounting).
- [ ] Run `bun run lint` and fix any issues it surfaces in the touched files.
- [ ] Run `bun run test` and ensure the full suite passes, including the two new tests.
- [ ] Run `bunx openspec validate rlf-104-agent-tui-crashes-on-non-tty-stdin-raw-m` and confirm it reports no errors.
