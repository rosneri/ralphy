# agent-features-vertical — vertical slice layout for agent features

## ADDED Requirements

### Requirement: Each agent feature MUST live as a vertical slice folder

Every feature MUST live as a self-contained folder under `apps/agent/src/features/<id>/` (one folder per feature id).

Every feature listed in [RLF-94](https://linear.app/neriros/issue/RLF-94) —
`confirmation`, `conflict-fix`, `ci-fix`, `implement`, `review-followup`,
`new-ticket`, `mention`, `stuck` — MUST be implemented as a self-contained
folder under `apps/agent/src/features/<id>/`. The folder MUST contain at
minimum an `index.ts` that exports a `Feature` descriptor conforming to
the contract in `apps/agent/src/features/types.ts`, and a co-located
`__tests__/` directory.

A slice MUST own writes to at most one top-level `state.*` slot (its
"owned slot"); other features MUST NOT write that slot. Reads across
slices are permitted. The `mention` slice MUST NOT write the
`state.confirmation` slot directly; it MUST instead emit
`feature.mention.reviseComment` events that the `confirmation` slice
consumes.

#### Scenario: confirmation slice replaces the old folder and coordinator dep

- **Given** the post-RLF-94 tree
- **When** I list `apps/agent/src/`
- **Then** `apps/agent/src/agent/confirmation/` does not exist
- **And** `apps/agent/src/features/confirmation/index.ts` exports a
  `Feature` with `id: "confirmation"` and `ownedSlot: "confirmation"`
- **And** `apps/agent/src/agent/coordinator.ts` does not reference
  `classifyAwaitingConfirmation`

#### Scenario: mention slice never writes the confirmation slot

- **Given** the `features/mention/` slice
- **When** I grep its source for writes to `state.confirmation`
- **Then** there are zero matches
- **And** the slice emits `feature.mention.reviseComment` events on the
  shared bus instead

### Requirement: Coordinator and post-task MUST dispatch via a feature registry

`apps/agent/src/agent/coordinator.ts` MUST iterate
`apps/agent/src/features/registry.ts` in declared order and route each
in-progress issue to the first feature whose `detect()` returns a
non-null match. The coordinator MUST NOT contain feature-specific
branching after this change.

`apps/agent/src/agent/post-task.ts` MUST iterate the same registry and
invoke `feature.postTask?.(ctx, taskResult)` exactly once per task, for
the feature whose `id` matches the task. The post-task tail MUST NOT
contain feature-specific branching after this change.

A failure inside one feature's `detect` MUST be caught, MUST emit
`feature.<id>.failed` on the shared bus, and MUST NOT prevent later
features in registry order from running for the same issue on the same
poll.

#### Scenario: detect throws does not block lower-priority features

- **Given** a registry `[A, B, C]` where `A.detect` throws
- **When** the coordinator processes an in-progress issue
- **Then** `feature.A.failed` is emitted on the bus
- **And** `B.detect` and `C.detect` are still invoked in order
- **And** the first non-null match runs as if `A` had returned null

#### Scenario: post-task dispatch is feature-id-driven

- **Given** a completed task with `featureId === "ci-fix"`
- **When** `runPostTask` walks the registry
- **Then** only `features/ci-fix/index.ts`'s `postTask` hook is invoked
- **And** no other feature's `postTask` runs for this task
