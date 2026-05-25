# Tasks for RLF-76

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-76/add-a-self-review-phase-that-loops-back-to-design-when-findings-remain and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Sub-ticket 1: Type + deriver + state schema

- [x] Add `reviewRounds: z.number().default(0)` to `StateSchema` in `packages/types/src/types.ts`
- [x] Add `"review"` to `OpenSpecPhase` union in `packages/core/src/openspec/phase.ts`
- [x] Extend `OpenSpecPhaseInputs` with `reviewFindings: string | null`, `reviewRounds: number`, `maxReviewRounds: number`
- [x] Update `deriveOpenSpecPhase` to return `"review"` / `"design"` / `"done"` per the new logic (enabled-only; default `maxReviewRounds: 0` preserves existing behavior)
- [x] Add `"review"` to `PIPELINE_PHASES` and update `shouldShowPhasePipeline` to handle `"review"`
- [x] Add `countOpenFindings(content: string): number` helper that counts `- [ ]` items under `## Open` in a review-findings file
- [x] Write unit tests in `packages/core/src/__tests__/openspec-phase.test.ts` covering: no-findings→done, findings→design loop-back, cap enforcement→done, enabled:false→done (no regression), `"review"` pipeline segment
- [x] Write unit tests for `countOpenFindings` helper
- [x] Run `bun run lint && bun run test` — all pass

### Sub-ticket 2: Workflow config + reviewer prompt

- [x] Add `openspec.reviewPhase.{enabled, maxRounds, reviewerModel, reviewerContextStrategy}` to `WorkflowConfigSchema` in `packages/workflow/src/schema.ts` (strict, enabled defaults false)
- [x] Write unit tests for schema parsing: valid config, unknown key rejection, defaults
- [x] Create `packages/content/src/review-self.md` with the self-review prompt (read artifacts + diff, write `## Open` findings or `(no findings — close round)`)
- [x] Extend `buildTaskPrompt` in `packages/core/src/loop.ts` to inject review-phase context when `reviewPhase.enabled` and all tasks are done: (a) first-review injection when no `review-findings.md`, (b) address-findings injection when open findings + `reviewRounds < maxRounds`
- [x] Run `bun run lint && bun run test` — all pass

### Sub-ticket 3: Fresh-context reviewer spawn + Linear emit

- [x] Add `reviewerContextStrategy?: "fresh" | "warm"` and `reviewerModel?: string` to `AgentRequest` in `packages/engine/src/agents/claude.ts` (or the protocol type); skip `--resume` when `strategy === "fresh"`, use `reviewerModel` if set
- [x] Wire the reviewer spawn in the agent loop runner (`apps/agent/src/agent/wire/runners.ts` or equivalent): detect review trigger, build reviewer prompt from artifacts + diff, spawn, read `review-findings.md`, increment `reviewRounds` in state
- [x] Emit Linear comment per round transition via the existing comment-sync channel (🔎 N findings / ✅ no findings / ⚠️ cap reached)
- [x] When cap reached with open findings, attach `review-findings.md` contents to the Linear issue before transitioning to done
- [x] Write characterization / integration tests: fresh spawn skips `resumeSessionId`, `reviewerModel` override applied, Linear comment emitted with correct text
- [x] Run `bun run lint && bun run test` — all pass
