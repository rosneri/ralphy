# review-phase Specification

## Purpose

TBD - created by archiving change rlf-76-add-a-self-review-phase-that-loops-back. Update Purpose after archive.

## Requirements

### Requirement: `deriveOpenSpecPhase` MUST return `"review"` when all tasks are complete and no `review-findings.md` exists yet (and `reviewPhase.enabled`)

When `proposal.md` and `design.md` are filled (non-stub), `tasks.md` has no unchecked items, `review-findings.md` is absent, and the workflow config has `openspec.reviewPhase.enabled: true`, `deriveOpenSpecPhase` MUST return `"review"`.

When `openspec.reviewPhase.enabled` is `false` (the default), `deriveOpenSpecPhase` MUST behave exactly as before this change — it MUST return `"done"` when all tasks are complete, regardless of `review-findings.md`.

#### Scenario: first review triggered after all tasks complete

- **Given** `proposal.md` has real prose, `design.md` has real prose, `tasks.md` has only checked items, `review-findings.md` does not exist, `reviewPhase.enabled: true`
- **When** `deriveOpenSpecPhase` is called
- **Then** it returns `"review"`

#### Scenario: review phase skipped when feature disabled (default)

- **Given** all tasks complete, `review-findings.md` absent, `reviewPhase.enabled: false`
- **When** `deriveOpenSpecPhase` is called
- **Then** it returns `"done"` — identical to pre-RLF-76 behavior

---

### Requirement: `deriveOpenSpecPhase` MUST return `"design"` when `review-findings.md` has open items and `reviewRounds < maxRounds`

A round is **open** iff `review-findings.md` contains at least one `- [ ]` item under `## Open`. When the round is open and the round counter has not reached the cap, the deriver MUST return `"design"` so the agent re-plans tasks to address the findings.

#### Scenario: findings remain, round cap not reached → loop back to design

- **Given** `review-findings.md` contains `- [ ] [security] …` under `## Open`, `reviewRounds: 1`, `maxRounds: 3`
- **When** `deriveOpenSpecPhase` is called
- **Then** it returns `"design"`

#### Scenario: findings remain, round cap reached → done

- **Given** `review-findings.md` has open items, `reviewRounds: 3`, `maxRounds: 3`
- **When** `deriveOpenSpecPhase` is called
- **Then** it returns `"done"` (cap enforcement; remaining findings MUST be attached to Linear before exiting)

#### Scenario: findings all resolved → done

- **Given** `review-findings.md` exists with only `- [x]` items under `## Open` (no `- [ ]` items), `reviewPhase.enabled: true`
- **When** `deriveOpenSpecPhase` is called
- **Then** it returns `"done"`

---

### Requirement: reviewer MUST run as a fresh-context spawn when `reviewerContextStrategy: "fresh"`

When `reviewerContextStrategy` is `"fresh"` (the default), the loop MUST spawn the reviewer as a new `claude -p` invocation with **no** `resumeSessionId`. The prompt MUST include only:

1. `proposal.md` contents
2. `design.md` contents
3. `tasks.md` contents
4. The `git diff origin/<prBaseBranch>...HEAD` output (the accumulated implementation diff)

The reviewer MUST write `review-findings.md` with an `## Open` section containing zero or more `- [ ]` items, each tagged with a category (`correctness`, `security`, `perf`, `tests`, `complexity`). If no issues are found, `## Open` MUST contain the literal `(no findings — close round)` sentinel instead of items.

#### Scenario: fresh reviewer never inherits the implementer's session

- **Given** the implementer ran in session `abc123`
- **When** the reviewer is spawned with `reviewerContextStrategy: "fresh"`
- **Then** the reviewer Claude process is launched with no `--resume abc123` flag

---

### Requirement: `StateSchema` MUST include `reviewRounds` persisted across iterations

`StateSchema` MUST expose a `reviewRounds: number` field with default `0`. The loop MUST increment `reviewRounds` each time it transitions from `"review"` back to `"design"` (i.e., each time open findings are detected and the cap has not been reached).

#### Scenario: old state file without `reviewRounds` parses without error

- **Given** a `.ralph-state.json` that was written before RLF-76 and lacks the `reviewRounds` key
- **When** `StateSchema.parse()` is called on the raw JSON
- **Then** parsing succeeds and `state.reviewRounds` equals `0`

#### Scenario: round counter increments on each loop-back

- **Given** `state.reviewRounds === 1` after the first loop-back
- **When** the loop detects open findings for a second time and transitions back to `"design"`
- **Then** `state.reviewRounds` is updated to `2` in the persisted state file

---

### Requirement: workflow config `openspec.reviewPhase` MUST parse and validate

`WorkflowConfigSchema` MUST accept:

```yaml
openspec:
  reviewPhase:
    enabled: true # boolean, default false
    maxRounds: 3 # positive integer, default 3
    reviewerModel: opus # "haiku" | "sonnet" | "opus", optional (falls back to global model)
    reviewerContextStrategy: fresh # "fresh" | "warm", default "fresh"
```

Unrecognised keys MUST be rejected (`.strict()`). When `enabled: false` (or absent), all other sub-keys are parsed but have no effect.

#### Scenario: valid full config parses without error

- **Given** a WORKFLOW.md with `openspec.reviewPhase.enabled: true`, `maxRounds: 5`, `reviewerModel: sonnet`, `reviewerContextStrategy: warm`
- **When** `WorkflowConfigSchema.parse()` is called
- **Then** parsing succeeds and `config.openspec.reviewPhase.maxRounds === 5`

#### Scenario: unknown key under `reviewPhase` is rejected

- **Given** a WORKFLOW.md with `openspec.reviewPhase.unknownKey: true`
- **When** `WorkflowConfigSchema.parse()` is called
- **Then** parsing throws a ZodError naming `unknownKey`

#### Scenario: omitted `openspec` block defaults to `enabled: false`

- **Given** a WORKFLOW.md with no `openspec` key at all
- **When** `WorkflowConfigSchema.parse()` is called
- **Then** `config.openspec.reviewPhase.enabled === false`

---

### Requirement: Linear MUST receive a comment per round transition

When the loop enters the `review` phase for round N, it MUST post a Linear comment of the form:

#### Scenario: findings found — comment reports count

- **Given** the reviewer writes `review-findings.md` with 3 `- [ ]` items under `## Open`, and this is round 2
- **When** the loop processes the review result
- **Then** a Linear comment `🔎 Review round 2 opened with 3 findings` is posted on the issue

#### Scenario: no findings — comment confirms close

- **Given** the reviewer writes `review-findings.md` with `(no findings — close round)` under `## Open`, and this is round 1
- **When** the loop processes the review result
- **Then** a Linear comment `✅ Review round 1: no findings — closing` is posted

#### Scenario: cap reached — warning comment and attachment

- **Given** open findings remain and `reviewRounds === maxRounds`
- **When** the loop determines the cap is reached
- **Then** a Linear comment `⚠️ Review round cap (maxRounds=N) reached with M open findings — see review-findings.md` is posted, and the findings list is attached to the issue

When the loop enters the `review` phase for round N, it MUST post a Linear comment of the form:

```
🔎 Review round N opened with M findings
```

where M is the count of `- [ ]` items under `## Open` in `review-findings.md`. When M = 0, it MUST post:

```
✅ Review round N: no findings — closing
```

When the round cap is reached with open findings, the loop MUST post:

```
⚠️ Review round cap (maxRounds=N) reached with M open findings — see review-findings.md
```

and attach the open-findings list to the Linear issue before transitioning to `done`.
