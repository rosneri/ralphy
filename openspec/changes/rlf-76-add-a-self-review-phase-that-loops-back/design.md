# Design for RLF-76: Add a self-review phase that loops back to design when findings remain

## Overview

The OpenSpec lifecycle gains a `review` phase between `implement` and `done`. When enabled, the loop spawns a fresh-context reviewer after all tasks are checked off. If the reviewer surfaces open findings, `deriveOpenSpecPhase` returns `"design"` and the agent re-plans `tasks.md` to address them. The round counter caps at `maxRounds` to prevent infinite spirals.

The feature is **opt-in** (`enabled: false` by default) so all existing projects see zero behavioral change.

## Files to Touch

### 1. `packages/types/src/types.ts`

Add `reviewRounds: z.number().default(0)` to `StateSchema` — persists the round counter across loop iterations. No migration needed; Zod's `.default(0)` silently fills the field for older state files.

### 2. `packages/core/src/openspec/phase.ts`

- Add `"review"` to `OpenSpecPhase` union.
- Extend `OpenSpecPhaseInputs` with:
  - `reviewFindings: string | null` — contents of `review-findings.md` (null if absent)
  - `reviewRounds: number` — current round count from state
  - `maxReviewRounds: number` — cap from workflow config (0 = disabled)
- Update `deriveOpenSpecPhase` logic:

  ```
  all tasks done AND maxReviewRounds > 0 AND no reviewFindings   → "review"
  all tasks done AND maxReviewRounds > 0 AND open findings
       AND reviewRounds < maxReviewRounds                         → "design"
  all tasks done AND (maxReviewRounds == 0 OR no open findings
       OR reviewRounds >= maxReviewRounds)                        → "done"
  ```

- Add `"review"` to `PIPELINE_PHASES` array (so TUI shows the segment when inputs include `maxReviewRounds > 0`). The `phasePipeline()` function already maps the array generically, so no additional changes needed there.
- Update `shouldShowPhasePipeline` to return `true` for `"review"` (it should show the pipeline, not the subtasks panel).

### 3. `packages/workflow/src/schema.ts`

Add nested `openspec` config block (the key doesn't exist today):

```ts
openspec: z.object({
  reviewPhase: z.object({
    enabled: z.boolean().default(false),
    maxRounds: z.number().int().positive().default(3),
    reviewerModel: z.enum(["haiku", "sonnet", "opus"]).optional(),
    reviewerContextStrategy: z.enum(["fresh", "warm"]).default("fresh"),
  }).strict().default({ enabled: false, maxRounds: 3, reviewerContextStrategy: "fresh" }),
}).strict().default({ reviewPhase: { enabled: false, maxRounds: 3, reviewerContextStrategy: "fresh" } }),
```

### 4. `packages/core/src/loop.ts`

Extend `buildTaskPrompt` with a review-phase injection block, analogous to the existing `manualTest` block:

```
if (config.openspec.reviewPhase.enabled) {
  if (noUncheckedTasks && noReviewFindings) {
    // inject: "Run the self-review phase — spawn fresh reviewer, write review-findings.md"
  } else if (noUncheckedTasks && openFindings && reviewRounds < maxRounds) {
    // inject: "Round N+1 — update design.md and tasks.md to address open findings in review-findings.md"
  }
}
```

`buildTaskPrompt` receives `WorkflowConfig` and `State` so it can read both `config.openspec.reviewPhase` and `state.reviewRounds`. The injected prompt sections reference the path to `review-findings.md` so the agent knows where to write/read.

### 5. `packages/engine/src/agents/claude.ts` (or `AgentRequest` protocol)

Add `reviewerContextStrategy?: "fresh" | "warm"` and `reviewerModel?: string` to `AgentRequest`. When `reviewerContextStrategy === "fresh"`, `buildClaudeArgs` MUST NOT include `--resume <sessionId>`. When `reviewerModel` is set, use it in place of `model`.

The review spawn passes a purpose-built prompt containing only:

- `proposal.md` contents (read from the change dir)
- `design.md` contents
- `tasks.md` contents
- `git diff origin/<prBaseBranch>...HEAD` output
- The reviewer instructions from `review-self.md`

### 6. New file: `packages/content/src/review-self.md`

Reviewer prompt (no YAML frontmatter — loaded as raw content):

```
You are a code reviewer. You did NOT write this code.

Read the diff, proposal.md, design.md, and tasks.md provided above.
Surface issues in five categories (priority order):
  correctness, security, perf, tests, complexity.

Write review-findings.md with this structure:

  # Review findings — round N (<ISO timestamp>)

  ## Open
  - [ ] [<category>] <file>:<line> — <description>

  ## Round metadata
  - model: <model>
  - reviewerContext: fresh

If you find NO issues, write:

  ## Open

  (no findings — close round)

Do not fix anything. Do not approve. Only surface findings.
```

### 7. Linear comment emit (in `apps/agent/src/agent/linear-sync/comment-sync.ts` or equivalent)

After the reviewer writes `review-findings.md` and the loop reads it, post a Linear comment via the existing `saveComment`/`postOrUpdatePlanComment` path. Use a dedicated comment type so it is not confused with the tasks-sync sticky comment.

### 8. `apps/agent/src/agent/wire/runners.ts` or wherever the loop runner calls the engine

After the per-iteration engine run, check whether:

- `reviewPhase.enabled`
- all tasks complete
- `review-findings.md` absent (first review) OR open findings + `reviewRounds < maxRounds`

If yes, spawn the reviewer with `reviewerContextStrategy`, increment `reviewRounds` in state, then post the Linear comment.

## Data Flow

```
tasks.md all checked
  ↓
(reviewPhase.enabled?)
  YES → review-findings.md absent?
          YES → spawn fresh reviewer → writes review-findings.md
                   open findings?
                     NO  → post "✅ no findings" comment → done
                     YES → reviewRounds < maxRounds?
                             YES → post "🔎 N findings" comment
                                  → increment reviewRounds in state
                                  → inject "address findings" design prompt next iter
                                  → agent rewrites design.md + tasks.md
                                  → loop: implement → review → …
                             NO  → post "⚠️ cap reached" comment
                                  → attach findings to Linear → done
  NO  → done (existing behavior, unchanged)
```

## Edge Cases

- **`enabled: false` (default)**: `deriveOpenSpecPhase` sees `maxReviewRounds == 0` and returns `"done"` immediately; no behavioral change.
- **Mid-round `[x]` marks**: only `- [ ]` items in `## Open` count; the regex `countOpenFindings` uses `/^- \[ \]/m` not `/^- \[/m`.
- **No-op design round**: if the design agent doesn't add any new unchecked tasks AND doesn't mark any findings resolved, the loop detects a no-op (tasks.md unchanged, resolved count unchanged) and force-advances to done with a warning log + Linear comment.
- **Round cap with open findings**: attach `review-findings.md` contents as a Linear comment before setting status to done.
- **Deleted-code references**: round N+1's design prompt explicitly instructs the agent to reconcile findings against the current diff; a finding referencing a line that no longer exists SHOULD be marked `[x]` as auto-resolved.

## Test Plan

- Unit tests for the updated `deriveOpenSpecPhase` (new paths: review, design loop-back, cap enforcement, disabled default) — in `packages/core/src/__tests__/openspec-phase.test.ts`.
- Unit tests for `StateSchema` accepting `reviewRounds` with default `0`.
- Unit tests for `WorkflowConfigSchema` parsing the new `openspec.reviewPhase` block.
- Unit tests for `countOpenFindings(content: string): number` helper.
- Integration / characterization tests for the loop runner covering: fresh spawn skips `resumeSessionId`, `reviewerModel` override applied, Linear comment emitted with correct round/count.
