# RLF-94: Stage 5 — Migrate features vertically

Source: [RLF-94](https://linear.app/neriros/issue/RLF-94/stage-5-migrate-features-vertically)
Status: In Progress
Labels: ralph:auto-merge, ralph:approved

## Why

Stages 0–4 built the scaffolding for the agent refactor (RLF-87):

- Stage 0 added characterization tests.
- Stage 1 introduced the event bus + file consumer.
- Stage 2 extracted pure detection functions.
- Stage 3 added the single-writer state store with feature-ownership slots
  (`linear-attachments`, `linear-comments`, `confirmation`, `review`, `ci`).
- Stage 4 wrapped every external side-effect (fs / git / gh / linear / worker)
  in a shared `Capability` shell with uniform retry, errors, and bus events.

What we still have is a horizontal layout: `coordinator.ts` (1262 LOC) does
the per-poll branching for every feature, `post-task.ts` (1090 LOC) does the
per-task tail for every feature, `confirmation/index.ts` lives in its own
folder, and `classifyAwaitingConfirmation` lives on a dependency in
`coordinator.ts`. A feature today is a fan-out of files: a detection in
`agent/`, a `Capability` use in `shared/capabilities/`, a state slot read
inline, and a switch arm in `coordinator.ts` and/or `post-task.ts`.

Stage 5 collapses each feature into a vertical slice under
`apps/agent/src/features/<name>/` that owns its detection, its capability
calls, its state slot, its bus events, and its own `__tests__/`. The
coordinator and `post-task` become thin dispatchers that ask each feature
"is this your turn?" and call into the slice — they stop knowing what any
individual feature does. Each feature lands as its own PR so the diff stays
reviewable; this change scopes the full set so the slices land in order:
`confirmation → conflict-fix → ci-fix → implement → review-followup →
new-ticket → mention → stuck`.

## What Changes

- **Add** `apps/agent/src/features/` as the new home for vertical slices.
  Each slice exports a `Feature` descriptor (id, `detect`, `run`, optional
  `postTask`, owned state slot) consumed by the coordinator/post-task
  dispatchers.
- **Add** `features/confirmation/` with flow, detect (gate, revise,
  roundsExhausted), capability (plan-ready, reminder, react), state, events
  and tests. This slice **replaces** `apps/agent/src/agent/confirmation/`
  and the `classifyAwaitingConfirmation` dependency on the coordinator.
- **Add** `features/conflict-fix/` whose `postTask` only verifies
  mergeability via the `getMergeability` capability; the push step lives
  inside the AI iteration (per [RLF-82](https://linear.app/neriros/issue/RLF-82)).
- **Add** `features/ci-fix/` as the sole owner of `state.ci` writes.
- **Add** `features/implement/` whose `postTask` keeps the push + hook-fix
  retry, and which owns `state.pr.url` / `state.pr.openedAt` writes.
- **Add** `features/review-followup/` that owns the
  `review.lastConsumedCommentAt` watermark from Stage 3.
- **Add** `features/new-ticket/`.
- **Add** `features/mention/` that emits `reviseComment` and other mention
  signals; it MUST NOT write the `confirmation` slot directly.
- **Add** `features/stuck/`.
- **Remove** the corresponding switch arms / dependencies from
  `coordinator.ts` and `post-task.ts`. After the migration the coordinator
  only owns: poll bucket aggregation, feature dispatch loop, and worker
  spawning; `post-task` only owns: shared pre/post hooks, dispatch by
  feature id, and worktree teardown.
- **Remove** `apps/agent/src/agent/confirmation/` entirely (replaced by the
  vertical slice). The `agent/linear.ts` re-export shim, `agent/wire.ts`,
  `agent/scaffold.ts`, `agent/baseline/`, `agent/pr.ts`, `agent/ci.ts`,
  `agent/linear-sync/`, `agent/json-runner.ts`, `agent/json-log/`,
  `agent/pr-url/`, `agent/poll-context/`, `agent/worktree.ts`, `agent/config.ts`
  remain (they are shared infrastructure, not features).

## Acceptance criteria

- `apps/agent/src/features/<name>/` exists for each of the 8 features above.
- Every feature slice has a co-located `__tests__/` directory and is the
  sole writer of its `state.*` slot (Stage 3 invariant preserved).
- `coordinator.ts` no longer references `classifyAwaitingConfirmation` and
  no longer has feature-specific branching: it iterates a feature registry.
- `post-task.ts` no longer has feature-specific switch arms: it iterates
  the same registry and calls `feature.postTask?.(...)` per match.
- `apps/agent/src/agent/confirmation/` is deleted.
- `bun run lint` and `bun run test` pass; coverage threshold is unchanged.
- Each feature merge keeps the agent green end-to-end (the characterization
  tests from Stage 0 stay passing throughout).

## Additional instructions

You are working on RLF-94: Stage 5 — Migrate features vertically.

Order matters: ship `confirmation` first because it exercises the full
contract (detect → state slot → capability → events → tests) and tightens
its existing bugs. Then `conflict-fix` and `ci-fix` (they benefit most from
per-flow `postTask`), then `implement` (largest), then the rest. **Merge
order:** Stages 0–4 must be merged first. Stage 6 builds on this.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
