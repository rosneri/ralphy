# RLF-76: Add a self-review phase that loops back to design when findings remain

Source: [RLF-76](https://linear.app/neriros/issue/RLF-76/add-a-self-review-phase-that-loops-back-to-design-when-findings-remain)
Status: Todo
Labels: Feature

## Why

The current OpenSpec loop transitions from `implement` directly to `done` once all `tasks.md` items are checked off. Bugs, security issues, and correctness gaps only surface when a human reviews the PR — too late in the cycle. Adding a self-review phase with a fresh LLM context lets the system catch defects before the PR is opened. Because the reviewer runs in a new conversation with no memory of writing the code, it is meaningfully more likely to surface genuine issues rather than rubber-stamping its own work. The loop-back to design when findings remain closes the defect-to-fix cycle without human intervention.

## Goal

Add a new OpenSpec lifecycle phase `review` between `implement` and `done`. When the review phase surfaces unresolved findings, the deriver loops back to `design` so the agent re-plans tasks to address them. Caps at `maxReviewRounds` (default 3) to prevent infinite spirals.

This is a self-critique cycle — orthogonal to the existing `codeReviewTrigger` that watches PR comments. The aim is to catch issues _before_ opening the PR (or the next round of work), with a different model / fresh context so the reviewer doesn't just rubber-stamp its own code.

## Pipeline

```
proposal → design → tasks → implement → review ─┬─ no findings → done
                                                 │
                                                 └─ findings    → design (round N+1)
                                                                  ↑
                                                       (cap at maxReviewRounds)
```

## New artifact: `review-findings.md`

```md
# Review findings — round 2 (2026-05-20T01:13Z)

## Open

- [ ] [security] Tokens logged at INFO in api-helpers.ts:42 — redact
- [ ] [perf] ModelSelector re-renders on every keystroke — memoize
- [ ] [tests] No test for the 401-recreate path in spec-attachments.ts

## Resolved in round 3

- [x] [security] Tokens logged → redacted in <commit>

## Round metadata

- model: claude-opus-4-7
- prompt: review-self.md
- reviewerContext: fresh
```

A round is **open** iff `## Open` has unchecked items.

## Phase derivation update (`packages/core/src/openspec/phase.ts`)

```ts
export type OpenSpecPhase = "proposal" | "design" | "tasks" | "implement" | "review" | "done";

function deriveOpenSpecPhase(inputs) {
  if (!inputs.hasProposal) return "proposal";
  if (!inputs.hasDesign) return "design";
  if (!inputs.hasTasks) return "tasks";
  if (inputs.hasUncheckedTasks) return "implement";
  if (!inputs.hasReviewFindings) return "review"; // first review
  if (inputs.openReviewFindings > 0 && inputs.reviewRounds < maxRounds) return "design"; // loop back
  return "done";
}
```

The "loop back to design" is the key trick: when `review-findings.md` has open items, the deriver returns `"design"`. The design prompt is told _new round; update design.md and tasks.md to address open findings_. The agent re-plans, re-tasks, re-implements, then re-reviews. Round counter sits in `.ralph-state.json` (new `reviewRounds` field on `StateSchema`).

## Workflow config

```yaml
openspec:
  reviewPhase:
    enabled: true # default false; opt-in per project
    maxRounds: 3
    # Use a different model so the review isn't the implementer marking its own work.
    reviewerModel: opus # falls back to global model if absent
    reviewerContextStrategy: fresh # "fresh" = no resumeSessionId; "warm" = inherits implementer ctx
```

## Why "fresh" reviewer context matters

An LLM rarely catches its own blind spots when reviewing in the same conversation. Two cheap improvements:

1. Spawn the reviewer as a **new** `claude -p` invocation with no `resumeSessionId`, fed only `proposal.md` + `design.md` + `tasks.md` + the final diff.
2. Optionally use a different model tier.

Both make findings genuinely independent. The `reviewerContextStrategy: "fresh"` knob controls (1).

## Reviewer prompt (extend `packages/content/phases/review.md`)

```
You are a code reviewer. You did NOT write the code. Read the diff
against the base branch, plus proposal.md and design.md. Surface
issues in five categories (priority order): correctness, security,
perf, tests, complexity. Append each as an `- [ ]` item under
`## Open` in review-findings.md, tagged with the category. If you find
nothing, append `## Open\n\n(no findings — close round)` and exit.
```

## Implementation order (3 sub-tickets)

### 1\. Type + deriver + state schema

- Add `"review"` to `OpenSpecPhase` in `packages/core/src/openspec/phase.ts`.
- Extend `deriveOpenSpecPhase` to handle the new artifact + round counter.
- Add `reviewRounds: z.number().default(0)` to `StateSchema` (`packages/types/src/types.ts`).
- Tests: no findings → done, findings → design loop, round cap → done.
- No behavior change unless the workflow flag is on.

### 2\. Workflow flag + prompt + UI

- Add `openspec.reviewPhase.{enabled, maxRounds, reviewerModel, reviewerContextStrategy}` to the workflow schema (`packages/workflow/src/schema.ts`).
- Add the review-phase prompt content.
- Update `phasePipeline()` so the TUI shows the `review` segment when the flag is on.
- Linear sync: emit a comment per round transition (`🔎 Review round 2 opened with 3 findings`).

### 3\. Reviewer-as-fresh-context spawn

- Wire the reviewer spawn in `packages/engine/src/agents/claude.ts` to skip `resumeSessionId` when `reviewerContextStrategy === "fresh"` and pass only the change artifacts + diff as the prompt.
- Add `reviewerModel` override to the engine `run()` request.

## Edge cases to design through up front

- **Items marked** `[x]` **mid-round shouldn't re-trigger.** Only `[ ]` items count toward the loop-back decision.
- **No-op design rounds.** If round N's design phase doesn't change anything (worker punted), `reviewRounds++` but tasks.md untouched → infinite loop. Mitigation: require that round N's design phase produces at least one tasks.md diff _or_ one resolved finding before re-entering implement; otherwise force-advance to done with a warning.
- **Round cap reached with open findings.** Don't silently exit — attach the remaining findings to the Linear issue as "known limitations" before transitioning to done.
- **Findings reference deleted code.** Round N+1's design phase must reconcile findings against the current diff (a finding for a line that no longer exists is auto-resolved).

## Non-goals

- Replacing the existing `codeReviewTrigger` (which watches _human_ PR comments) — that stays as-is. This is a separate self-review pre-PR.
- Multi-reviewer ensembles. Single reviewer per round; we can add a second reviewer model later if findings quality is low.

## What Changes

- Add `"review"` to the `OpenSpecPhase` union in `packages/core/src/openspec/phase.ts` and extend `deriveOpenSpecPhase` to return `"review"` after all tasks are complete (no `review-findings.md` yet), `"design"` when open findings exist and `reviewRounds < maxRounds`, and `"done"` otherwise.
- Extend `OpenSpecPhaseInputs` with `reviewFindings: string | null` and `reviewRounds: number` so the deriver can read the new artifact and round counter.
- Add `"review"` to `PIPELINE_PHASES` and update `shouldShowPhasePipeline` so the TUI progress bar shows the review segment when the feature is enabled.
- Add `reviewRounds: z.number().default(0)` to `StateSchema` in `packages/types/src/types.ts` so round state survives across iterations.
- Add `openspec.reviewPhase.{enabled, maxRounds, reviewerModel, reviewerContextStrategy}` to `WorkflowConfigSchema` in `packages/workflow/src/schema.ts`; `enabled` defaults to `false` so existing projects see no behavioral change.
- Add a new `review-self.md` prompt in `packages/content/` describing the self-review task (read diff + artifacts, write `## Open` findings to `review-findings.md`).
- Wire the reviewer as a fresh-context spawn in the loop runner: when all tasks are done and `reviewPhase.enabled`, launch a new `claude -p` invocation with no `resumeSessionId`, feeding only `proposal.md`, `design.md`, `tasks.md`, and the base-branch diff; optionally override the model via `reviewerModel`.
- Emit a Linear comment per round transition (e.g. `🔎 Review round 2 opened with 3 findings`) through the existing Linear comment-sync channel.
- When `reviewRounds >= maxRounds` and open findings remain, attach the findings list to the Linear issue as a comment before transitioning to `done`.

## Additional instructions

You are working on RLF-76: Add a self-review phase that loops back to design when findings remain.

## Goal

Add a new OpenSpec lifecycle phase `review` between `implement` and `done`. When the review phase surfaces unresolved findings, the deriver loops back to `design` so the agent re-plans tasks to address them. Caps at `maxReviewRounds` (default 3) to prevent infinite spirals.

This is a self-critique cycle — orthogonal to the existing `codeReviewTrigger` that watches PR comments. The aim is to catch issues _before_ opening the PR (or the next round of work), with a different model / fresh context so the reviewer doesn't just rubber-stamp its own code.

## Pipeline

```
proposal → design → tasks → implement → review ─┬─ no findings → done
                                                 │
                                                 └─ findings    → design (round N+1)
                                                                  ↑
                                                       (cap at maxReviewRounds)
```

## New artifact: `review-findings.md`

```md
# Review findings — round 2 (2026-05-20T01:13Z)

## Open

- [ ] [security] Tokens logged at INFO in api-helpers.ts:42 — redact
- [ ] [perf] ModelSelector re-renders on every keystroke — memoize
- [ ] [tests] No test for the 401-recreate path in spec-attachments.ts

## Resolved in round 3

- [x] [security] Tokens logged → redacted in <commit>

## Round metadata

- model: claude-opus-4-7
- prompt: review-self.md
- reviewerContext: fresh
```

A round is **open** iff `## Open` has unchecked items.

## Phase derivation update (`packages/core/src/openspec/phase.ts`)

```ts
export type OpenSpecPhase = "proposal" | "design" | "tasks" | "implement" | "review" | "done";

function deriveOpenSpecPhase(inputs) {
  if (!inputs.hasProposal) return "proposal";
  if (!inputs.hasDesign) return "design";
  if (!inputs.hasTasks) return "tasks";
  if (inputs.hasUncheckedTasks) return "implement";
  if (!inputs.hasReviewFindings) return "review"; // first review
  if (inputs.openReviewFindings > 0 && inputs.reviewRounds < maxRounds) return "design"; // loop back
  return "done";
}
```

The "loop back to design" is the key trick: when `review-findings.md` has open items, the deriver returns `"design"`. The design prompt is told _new round; update design.md and tasks.md to address open findings_. The agent re-plans, re-tasks, re-implements, then re-reviews. Round counter sits in `.ralph-state.json` (new `reviewRounds` field on `StateSchema`).

## Workflow config

```yaml
openspec:
  reviewPhase:
    enabled: true # default false; opt-in per project
    maxRounds: 3
    # Use a different model so the review isn't the implementer marking its own work.
    reviewerModel: opus # falls back to global model if absent
    reviewerContextStrategy: fresh # "fresh" = no resumeSessionId; "warm" = inherits implementer ctx
```

## Why "fresh" reviewer context matters

An LLM rarely catches its own blind spots when reviewing in the same conversation. Two cheap improvements:

1. Spawn the reviewer as a **new** `claude -p` invocation with no `resumeSessionId`, fed only `proposal.md` + `design.md` + `tasks.md` + the final diff.
2. Optionally use a different model tier.

Both make findings genuinely independent. The `reviewerContextStrategy: "fresh"` knob controls (1).

## Reviewer prompt (extend `packages/content/phases/review.md`)

```
You are a code reviewer. You did NOT write the code. Read the diff
against the base branch, plus proposal.md and design.md. Surface
issues in five categories (priority order): correctness, security,
perf, tests, complexity. Append each as an `- [ ]` item under
`## Open` in review-findings.md, tagged with the category. If you find
nothing, append `## Open\n\n(no findings — close round)` and exit.
```

## Implementation order (3 sub-tickets)

### 1\. Type + deriver + state schema

- Add `"review"` to `OpenSpecPhase` in `packages/core/src/openspec/phase.ts`.
- Extend `deriveOpenSpecPhase` to handle the new artifact + round counter.
- Add `reviewRounds: z.number().default(0)` to `StateSchema` (`packages/types/src/types.ts`).
- Tests: no findings → done, findings → design loop, round cap → done.
- No behavior change unless the workflow flag is on.

### 2\. Workflow flag + prompt + UI

- Add `openspec.reviewPhase.{enabled, maxRounds, reviewerModel, reviewerContextStrategy}` to the workflow schema (`packages/workflow/src/schema.ts`).
- Add the review-phase prompt content.
- Update `phasePipeline()` so the TUI shows the `review` segment when the flag is on.
- Linear sync: emit a comment per round transition (`🔎 Review round 2 opened with 3 findings`).

### 3\. Reviewer-as-fresh-context spawn

- Wire the reviewer spawn in `packages/engine/src/agents/claude.ts` to skip `resumeSessionId` when `reviewerContextStrategy === "fresh"` and pass only the change artifacts + diff as the prompt.
- Add `reviewerModel` override to the engine `run()` request.

## Edge cases to design through up front

- **Items marked** `[x]` **mid-round shouldn't re-trigger.** Only `[ ]` items count toward the loop-back decision.
- **No-op design rounds.** If round N's design phase doesn't change anything (worker punted), `reviewRounds++` but tasks.md untouched → infinite loop. Mitigation: require that round N's design phase produces at least one tasks.md diff _or_ one resolved finding before re-entering implement; otherwise force-advance to done with a warning.
- **Round cap reached with open findings.** Don't silently exit — attach the remaining findings to the Linear issue as "known limitations" before transitioning to done.
- **Findings reference deleted code.** Round N+1's design phase must reconcile findings against the current diff (a finding for a line that no longer exists is auto-resolved).

## Non-goals

- Replacing the existing `codeReviewTrigger` (which watches _human_ PR comments) — that stays as-is. This is a separate self-review pre-PR.
- Multi-reviewer ensembles. Single reviewer per round; we can add a second reviewer model later if findings quality is low.

Labels: Feature

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
