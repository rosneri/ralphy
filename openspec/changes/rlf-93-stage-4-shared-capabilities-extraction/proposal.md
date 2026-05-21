# RLF-93: Stage 4 — Shared capabilities extraction

Source: [RLF-93](https://linear.app/neriros/issue/RLF-93/stage-4-shared-capabilities-extraction)
Status: In Progress
Labels: ralph:auto-merge, ralph:approved

## Why

Part of [RLF-87](https://linear.app/neriros/issue/RLF-87). Today every external side effect — Linear GraphQL, GitHub CLI, git/worktree, fs writes inside the change dir, worker spawning, and per-poll memoization — lives inline in `apps/agent/src/agent/wire.ts` and `coordinator.ts`. That tangle has three real problems:

1. **No uniform retry / error contract.** Linear retries live in `linear.ts`; gh/git runners do not retry at all. Error formatting is ad-hoc, which is why issues such as [RLF-60](https://linear.app/neriros/issue/RLF-60) (opaque Linear errors) and [RLF-65](https://linear.app/neriros/issue/RLF-65) (status/body lost on failure) keep recurring.
2. **The `SpawnMode` enum (`fresh | resume | conflict-fix | review`) is leaking everywhere.** `queue/queue-order.ts`, `coordinator.ts`, and `wire.ts` all branch on it. The mode actually only changes one thing: whether `tasks.md` gets a one-shot directive prepended. That is a `fs-change` concern, not a coordinator concern.
3. **Forced worktree creation can silently fall back to `projectRoot`** if a future refactor moves the `throw` ([RLF-39](https://linear.app/neriros/issue/RLF-39)). There is no compile-time invariant that prevents it; the protection is a single `throw err` in `wire.ts`.

Stages 0–3 already extracted the event bus (RLF-90), pure detections (RLF-91), and the shared state schema (RLF-92). This stage is the last extraction needed before Stage 5 can split the coordinator into feature loops: pull I/O surfaces out into `shared/capabilities/*` with a uniform shape, drop the worker-mode enum, and have the capability shell auto-emit bus events so consumers never have to remember to log.

## What Changes

- Add `apps/agent/src/shared/capabilities/` with one module per I/O surface: `linear-client.ts`, `gh-client.ts`, `git.ts`, `fs-change.ts`, `worker-spawner.ts`, `poll-context.ts`.
- Every capability exports a `Capability` descriptor `{ name, required, retryPolicy, errorFormatter, adopt? }` consumed by a shared `runCapability(...)` shell.
- `runCapability` auto-emits bus events `${capabilityName}.${operation}.started|fetched|failed` so call sites no longer hand-roll telemetry.
- Linear client (moved out of `apps/agent/src/agent/linear.ts`) keeps its retry on 5xx / `Retry-After` and now also retries 429 with backoff (today it throws immediately). `errorFormatter` returns `status + truncated body + GraphQL messages`.
- Worktree capability declares `required: true`. Its `errorFormatter` quarantines the ticket with `ralph:error` and `runCapability` enforces that a thrown required capability never returns a result — closing the [RLF-39](https://linear.app/neriros/issue/RLF-39) gap so `workerCwd === projectRoot` is unreachable by construction.
- `worker-spawner.ts` exposes a single `spawnWorker({ cwd, changeName, steeringNote?, prependTask? })`. The `SpawnMode` enum in `apps/agent/src/queue/queue-order.ts` is deleted. Queue ordering switches to an explicit `priority: number` derived by the queue from detection signals. Call sites that previously branched on `mode === "resume" | "conflict-fix" | "review"` now call `fsChange.prependTask(changeName, directive)` themselves before spawning.
- `PollContext` moves from `apps/agent/src/agent/poll-context/index.ts` to `shared/capabilities/poll-context.ts`. Lifetime is documented and tested: created in `beforePoll`, dropped at end of poll, memoization is per-call (URL + sorted fields).
- Add `no-restricted-imports` ESLint rule (severity `warn`) enforcing:
  - no cross-feature imports under `apps/agent/src/agent/*` (sibling feature dirs must not import each other);
  - no `features → runtime/consumers` imports;
  - no `consumers → features/capabilities` imports;
  - no I/O imports inside `*/detect.ts` files (no `Bun.spawn`, no `@ralphy/agent/*linear*|*gh*|*git*`).

### Acceptance criteria

- `apps/agent/src/agent/wire.ts` and `coordinator.ts` no longer import `node:child_process`, `Bun.spawn`, or call Linear/gh/git directly. All such calls go through `shared/capabilities/*`.
- `grep -R "SpawnMode" apps/ packages/` returns nothing.
- Every capability test exercises retry on transient failure, the `errorFormatter` shape, and `required: true` semantics (thrown → no result).
- Linear retry test asserts 429 + `Retry-After` is honored.
- Worktree capability test asserts that a thrown forced creation never produces a result with `cwd === projectRoot`.
- PollContext test asserts memoization key (URL + sorted fields) and one-tick lifetime.
- `bun run lint` reports the new `no-restricted-imports` warnings for any pre-existing violations but does not fail (severity is `warn`).
- `bun run test` and `bun run lint` pass.

## Additional instructions

You are working on RLF-93: Stage 4 — Shared capabilities extraction.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
