# Tasks for RLF-75

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-75/preflight-auth-checks-fail-fast-when-gh-or-claude-is-unauthenticated and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [x]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `packages/engine/src/preflight/env.ts` exporting `scrubClaudeEnv(env?)` that removes `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT` from a shallow copy and defaults its argument to `process.env`.
- [x] Add `packages/engine/src/preflight/gh.ts` exporting `checkGhAuth()` which spawns `gh auth status` via the local `spawn` helper, returns `{ ok: true }` on exit 0, otherwise `{ ok: false, tool: "gh", message: GH_AUTH_FAIL_MESSAGE }`. Export `GH_AUTH_FAIL_MESSAGE` containing the strings `gh is not authenticated` and `gh auth login`.
- [x] Add `packages/engine/src/preflight/claude.ts` exporting `checkClaudeAuth()` which spawns `claude -p "say ok" --output-format text` with `env: scrubClaudeEnv(process.env)`, reads stdout, and returns the claude-named failure if exit ≠ 0 or stdout matches `/Not logged in|Please run \/login/`. Export `CLAUDE_AUTH_FAIL_MESSAGE` containing the strings `claude CLI is not authenticated` and `/login`. Bound the probe with a 30s AbortController.
- [x] Add `packages/engine/src/preflight/run.ts` exporting `runPreflight()` that runs `checkGhAuth()` then `checkClaudeAuth()` and short-circuits on the first failure.
- [x] Add `packages/engine/src/preflight/index.ts` re-exporting `runPreflight`, `scrubClaudeEnv`, `PreflightResult`, `PreflightTool`, and the failure-message constants.
- [x] Update `packages/engine/src/agents/claude.ts` so both `runInteractive` and `run` pass `env: scrubClaudeEnv(process.env)` into their `spawn(...)` calls. Import from the new `../preflight` module.
- [x] Wire preflight into `apps/agent/src/agent/json-runner.ts`: call `runPreflight()` after `LINEAR_API_KEY` is validated and before any `emit({ type: "started", … })`. On failure emit `{ type: "error", code: "auth_failure", tool, text }`, set `process.exitCode = 2`, and return.
- [x] Wire preflight into `apps/agent/src/components/AgentMode.tsx`: add an optional `runPreflight` prop (default = real impl), run it in a startup effect before `buildAgentCoordinator`, and on failure render a single red error block and set `process.exitCode = 2` without mounting the worker dashboard.
- [x] Add `packages/engine/src/__tests__/preflight.test.ts` covering: scrub keys (positive + negative), gh exit-0 path, gh exit-1 path, claude clean stdout, claude `Not logged in` stdout with exit 0, claude exit ≠ 0, `runPreflight` short-circuit. Mock spawning by patching the local `spawn` re-export following the existing Bun-native pattern in `packages/openspec/src/__tests__/openspec-change-store.test.ts`.
- [x] Add a test in `packages/engine/src/__tests__/agents.test.ts` (or a new file) asserting `claudeAgent.run` invokes `spawn` with an `env` lacking `CLAUDECODE` when `process.env.CLAUDECODE` is set.
- [x] Add a test in `apps/agent/src/__tests__/` asserting JSON-runner emits exactly one `auth_failure` event and exits 2 when the injected `runPreflight` returns a failure, and that no `started`/`poll_*` events precede it.
- [x] Run `bun run lint` and resolve any findings.
- [x] Run `bun run test` and ensure the suite passes (including new tests) without lowering the coverage threshold.
- [x] Run `bunx openspec validate rlf-75-preflight-auth-checks-fail-fast-when-gh` and resolve any validator complaints.

## Manual Testing

- [x] JSON mode with broken `gh`: shim a failing `gh` on `PATH`, run `bun apps/agent/src/index.ts --json-output` with a dummy `LINEAR_API_KEY`, and confirm stdout contains exactly one `{"type":"error","code":"auth_failure","tool":"gh", ...}` line, no `started`/`poll_*` events precede it, and the process exits with code 2.
- [x] JSON mode with broken `claude`: shim a `claude` that prints `Not logged in` and exits 0, repeat the run, and confirm the single emitted error event has `tool: "claude"`, message references `/login`, and exit code is 2.
- [x] JSON mode with `CLAUDECODE=1` inherited: export `CLAUDECODE=1`, point `claude` at a shim that prints whatever it sees in its env to stderr, and confirm the spawned probe does NOT see `CLAUDECODE` (i.e. preflight runs against a scrubbed env).
- [x] Worker `claude` env scrub: write a tiny adapter test or shim that captures the child env passed to `claudeAgent.run`, set `CLAUDECODE=1` in the parent, and confirm the child env lacks `CLAUDECODE`/`CLAUDE_CODE_*`/`AI_AGENT`.
