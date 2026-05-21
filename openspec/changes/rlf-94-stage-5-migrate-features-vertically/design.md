# Design for RLF-94 — Stage 5: vertical feature slices

## Goal

Collapse the per-feature fan-out across `coordinator.ts` (1262 LOC) and
`post-task.ts` (1090 LOC) into self-contained `Feature` modules under
`apps/agent/src/features/<name>/`. The coordinator and `post-task` become
generic dispatchers driven by a feature registry.

## The Feature contract

A new module `apps/agent/src/features/types.ts` defines:

```ts
export interface FeatureCtx {
  issue: LinearIssue; // current Linear issue
  worktree: string; // absolute path to its worktree
  state: StateStore; // single-writer slot accessor (Stage 3)
  bus: EventBus; // @ralphy/events bus (Stage 1)
  caps: Capabilities; // bundled capability handles (Stage 4)
  poll: PollContext; // per-poll memo (Stage 3)
  now: () => Date; // injected clock for tests
}

export interface FeatureMatch {
  /** Reason this feature wants to run this poll; surfaced in bus events. */
  reason: string;
}

export interface Feature {
  /** Stable id, used as the bus subsystem prefix and the feature registry key. */
  id: FeatureId;
  /** Which top-level `state.*` slot this feature owns (Stage 3 invariant). */
  ownedSlot: keyof StateSlotMap | null;
  /** Returns a FeatureMatch when this feature wants the poll, else null. */
  detect(ctx: FeatureCtx): Promise<FeatureMatch | null>;
  /** Run the feature for this poll. Bus events use `id` as subsystem prefix. */
  run(ctx: FeatureCtx, match: FeatureMatch): Promise<void>;
  /** Optional per-feature post-task hook (replaces switch arms in post-task.ts). */
  postTask?(ctx: FeatureCtx, taskResult: TaskResult): Promise<void>;
}

export type FeatureId =
  | "confirmation"
  | "conflict-fix"
  | "ci-fix"
  | "implement"
  | "review-followup"
  | "new-ticket"
  | "mention"
  | "stuck";
```

A `registry.ts` exports the ordered list of features. The coordinator
calls `detect()` in registry order and routes the issue to the first
match (today's coordinator already encodes this ordering implicitly via
its branching).

## Per-feature slice layout

Every slice has the same shape; deviations call out in their own section
below:

```
apps/agent/src/features/<id>/
  index.ts            // exports the Feature descriptor
  detect.ts           // pure detection (Stage 2 style)
  run.ts              // orchestration: calls capabilities, updates state, emits events
  state.ts            // typed accessor for state.<id> (only writer)
  events.ts           // typed helpers around bus.emit for this feature
  __tests__/
    detect.test.ts
    run.test.ts
    state.test.ts
```

Optional files when relevant: `post-task.ts` (for slices that own a
post-task tail), `prompts.ts` (templated strings for capability calls).

### Slice-by-slice notes

| feature         | owned slot                                                      | post-task?                     | replaces                                                  |
| --------------- | --------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| confirmation    | `confirmation`                                                  | no                             | `agent/confirmation/`, `classifyAwaitingConfirmation` dep |
| conflict-fix    | (none — reads `pr.mergeable` via poll context)                  | yes (mergeability verify only) | coordinator + post-task branches                          |
| ci-fix          | `ci`                                                            | yes                            | coordinator + post-task branches                          |
| implement       | `pr` (url/openedAt)                                             | yes (push + hook-fix retry)    | coordinator + post-task branches                          |
| review-followup | `review.lastConsumedCommentAt`                                  | no                             | coordinator branch                                        |
| new-ticket      | none                                                            | no                             | coordinator branch                                        |
| mention         | none — emits signals; never writes `confirmation` slot directly | no                             | coordinator branch + part of wire.fetchMentions           |
| stuck           | none                                                            | no                             | coordinator branch                                        |

## Files to touch

### New

- `apps/agent/src/features/types.ts`
- `apps/agent/src/features/registry.ts`
- `apps/agent/src/features/run-feature.ts` (shared try/catch + bus wrapping)
- `apps/agent/src/features/confirmation/{index,detect,run,state,events}.ts`
  and `__tests__/`
- … same per remaining feature.

### Modify

- `apps/agent/src/agent/coordinator.ts`: drop per-feature branches; iterate
  registry; remove the `classifyAwaitingConfirmation` dep field.
- `apps/agent/src/agent/post-task.ts`: drop per-feature branches; iterate
  registry and call `feature.postTask?.(...)`.
- `apps/agent/src/agent/wire.ts`: stop computing classification helpers
  that are now feature-internal; keep mention scan + shared GH/linear glue.
- `packages/events/src/types.ts`: extend `RalphEvent` with
  `feature.<id>.{detected,started,completed,failed,skipped}` literals (one
  set per feature).
- `packages/types/src/types.ts`: extend `StateSlotMap` with any new slot
  keys (most already exist post-Stage 3).

### Delete

- `apps/agent/src/agent/confirmation/` (folder).

## Data flow per poll

1. Coordinator builds the shared `FeatureCtx` (state store, poll context,
   capability bundle, bus, clock).
2. For each in-progress issue, it iterates the registry in order and
   awaits `feature.detect(ctx)`. First non-null match wins.
3. It emits `feature.<id>.detected { reason }` and calls
   `feature.run(ctx, match)` wrapped by `runFeature(...)` which translates
   throws into `feature.<id>.failed` bus events.
4. After the worker subprocess finishes (per-task tail), `runPostTask`
   walks the same registry and calls `feature.postTask?.(...)` for the
   feature whose `id` matches the task. Feature post-task hooks are the
   sole writers of their `state.*` slot.

## Edge cases

- **Two features detect on the same poll**: registry order resolves it
  (matches today's `if/else if` chain). Bus emits `feature.<id>.skipped
{ reason: "preempted-by:<id>" }` for the losing detectors so telemetry
  doesn't silently drop them.
- **Feature throws inside `detect`**: `runFeature` catches, emits
  `feature.<id>.failed`, and continues registry iteration (a broken
  detection MUST NOT block lower-priority features).
- **State slot collision**: the typed `state.writeField(slot, ...)` from
  Stage 3 already enforces single-writer ownership; the coordinator no
  longer touches feature slots directly, so the invariant becomes a
  compile-time fact instead of a runtime check.
- **Mention slice writing confirmation**: explicitly forbidden — the
  mention slice emits `reviseComment` events that the confirmation slice
  subscribes to. Enforced by an ESLint-style boundary test that fails if
  `features/mention/**` imports `features/confirmation/state`.
- **Migration safety**: each feature lands in its own PR. Until a slice
  ships, the old branch in `coordinator.ts`/`post-task.ts` stays in
  place. The registry holds adapters that point at the old code paths
  for not-yet-migrated features so the coordinator can already iterate
  the registry from day one. Stage-0 characterization tests gate every
  merge.

## Test strategy

- Per-slice unit tests for detect/run/state/events (Bun's test runner,
  mocking only `Bun.spawnSync`/HTTP via the capability seams).
- Coordinator + post-task tests: assert they call `runFeature` and
  `feature.postTask` for the right registry entries and never touch
  feature-specific data.
- Characterization tests from Stage 0 stay green for each PR.
- Boundary test: forbid cross-feature imports except through
  `features/types.ts` and shared `features/run-feature.ts`.
