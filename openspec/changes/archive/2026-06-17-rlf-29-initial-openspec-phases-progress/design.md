# Design for RLF-29

## Goal

Replace the numeric task progress bar in the agent-mode header with an
OpenSpec phase pipeline (`proposal → design → tasks → implement`) until the
change reaches the `implement` phase, at which point the existing task
progress bar takes over.

## Files touched

- `packages/core/src/openspec/phase.ts` — add a pure helper
  `phasePipeline(phase: OpenSpecPhase): PhaseSegment[]` that returns the
  ordered segment list with per-segment status (`done` | `current` |
  `pending`). Keeping the helper in core (not in the UI) makes it
  unit-testable without React/Ink.
- `packages/core/src/__tests__/openspec-phase.test.ts` — extend with cases
  for `phasePipeline` across all five phase values.
- `apps/agent/src/components/AgentMode.tsx` — render the pipeline when
  `openspecPhase !== "implement"` (or `null`, i.e. unknown). When the phase
  is `implement`, keep the current numeric bar. Use the segment list from
  the core helper.

No changes to:

- `packages/core/src/progress.ts` (counting logic).
- Loop logic (`apps/agent/src/loop/*`), state store, or any persisted file
  format.

## Data flow

```
state.json + change dir files
        │
        ▼
useEffect polling loop (AgentMode.tsx, ~line 540)
  ├── countProgress(tasksText)   → meta.taskProgress  (numeric bar input)
  └── deriveOpenSpecPhase(...)    → meta.openspecPhase (existing)
                                          │
                                          ▼
                                phasePipeline(phase) (new, in core)
                                          │
                                          ▼
                              <PhasePipelineBar segments={...} />  (new
                              inline render block in AgentMode.tsx)
```

The render condition in `AgentMode.tsx`:

```ts
if (openspecPhase && openspecPhase !== "implement") {
  // render pipeline
} else if (taskProgress) {
  // render existing numeric bar
}
```

`done` falls into the _pipeline_ branch on purpose so that all four phases
visibly tick over to complete on the final iteration before the change is
merged.

## `phasePipeline` shape

```ts
export type PhaseSegmentStatus = "done" | "current" | "pending";

export interface PhaseSegment {
  phase: OpenSpecPhase; // one of: proposal | design | tasks | implement
  label: string; // human-readable label, currently same as phase
  status: PhaseSegmentStatus;
}

export function phasePipeline(phase: OpenSpecPhase): PhaseSegment[];
```

Order: `proposal, design, tasks, implement`. `done` collapses to "all four
segments marked `done`". For any other phase, segments before it are `done`,
the matching one is `current`, the rest are `pending`.

Rationale for excluding `done` from the visible label list: the pipeline
represents _active_ lifecycle stages; "done" is the post-state, not a stage
the loop occupies while working. Showing it as a fifth segment would either
flicker on for one frame or be permanently dim, neither of which is useful.

## Rendering

Inline in `AgentMode.tsx`, mirroring the existing progress-bar block at line
~980. For each segment:

| status    | glyph | color                               | bold |
| --------- | ----- | ----------------------------------- | ---- |
| `done`    | `✓`   | `green`                             | no   |
| `current` | `●`   | `openspecPhaseColor(segment.phase)` | yes  |
| `pending` | `○`   | dim (Ink `dimColor`)                | no   |

Segments are separated by `─` (dim). The whole line sits in the same `<Box>`
slot as the numeric bar so layout doesn't shift when the bar swaps in at
`implement`.

Width-wise, the pipeline is short (~40 chars at most), well under the
narrowest terminal we render at, so we do not try to truncate it.

## Edge cases

- **No change dir yet / files unreadable**: `openspecPhase` is `null`. We
  fall through to the existing numeric bar branch, which itself short-
  circuits on `!taskProgress`. Net effect: nothing rendered, same as today.
- **`tasks.md` missing but `proposal.md` and `design.md` filled**:
  `deriveOpenSpecPhase` returns `tasks`. Pipeline shows proposal/design done,
  tasks current, implement pending. Correct.
- **Implementation section is appended but contains zero `- [ ]` items**:
  `deriveOpenSpecPhase` returns `done` (no unchecked items). Pipeline shows
  all done. Acceptable — this is also the terminal state.
- **Race between phase derivation and tasks count**: both come from the same
  polling tick, so the render is consistent within a frame.

## Testing

- `phasePipeline` unit tests in `openspec-phase.test.ts` covering each of
  `proposal`, `design`, `tasks`, `implement`, `done` and asserting the
  full segment array.
- No new test framework or harness needed; existing `bun test` setup covers
  the file.

## Risk / rollback

Low. The change is additive (new helper) plus a localized render-branch
swap in one component. Rolling back is a single revert.
