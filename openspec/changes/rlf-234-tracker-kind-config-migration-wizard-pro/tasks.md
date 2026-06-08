# Tasks for RLF-234

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-234/trackerkind-config-migration-wizard-provider-selection and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### Schema + migration

- [x] Add a `tracker: { kind: "linear" | "github" }` block to `WorkflowConfigSchema` in `packages/workflow/src/schema.ts`, defaulting to `{ kind: "linear" }` (`.strict()`, `.default(...)`).
- [x] Extend the existing `github` block with an optional `issues` sub-block (`repo`, `label`, `assignee`, `statusLabels: { inProgress, done, error }` with the `ralph:*` defaults); keep the block `.strict()` and ensure github blocks without `issues` still validate.
- [x] Bump `CURRENT_WORKFLOW_VERSION` 6 → 7 in `packages/workflow/src/schema.ts`.
- [x] Add the `tracker:` and `github.issues:` keys to `DEFAULT_WORKFLOW_MD` (`packages/workflow/src/default.ts`) so the wizard stamps descriptions and documents defaults.
- [x] Add a version-7 entry to `MIGRATIONS` in `apps/init/src/migrations.ts` whose `fields` list `tracker.kind` and every `github.issues.*` id, with a user-facing `description`.

### Wizard

- [x] Add a `tracker.kind` select field (options: Linear (default), GitHub) to the catalogue in `packages/workflow/src/fields.ts`, with a description.
- [x] Add `github.issues.*` fields gated with `when` so they only prompt when `tracker.kind === "github"`; register them in the appropriate field list and `FIELD_DESCRIPTIONS`.
- [x] Update `apps/init/src/SetupWizard.tsx` so the new questions appear in the flow and the github keys are not written when Linear is chosen (control-answer / gating handling).

### Provider seam

- [x] Add `apps/agent/src/agent/wire/tracker/types.ts` defining the `TrackerProvider` interface and `TrackerIssue` shape (the subset of `LinearIssue` the loop reads).
- [x] Make `createLinearResolvers` / `fetchDoneCandidatesWith` conform to `TrackerProvider` (additive typing only — no behavior change).
- [x] Add `apps/agent/src/agent/wire/tracker/github.ts` with `createGithubTrackerProvider` implementing the interface via `cmdRunner` + `gh issue list/edit/comment/close` (todo fetch, set in-progress, comment, set done+close, set error, done-candidate fetch). Default the repo to the detected `origin` and error clearly when none can be resolved.
- [x] In `apps/agent/src/agent/wire.ts`, select `createGithubTrackerProvider` vs `createLinearResolvers` by `cfg.tracker.kind` and thread the chosen provider where `resolvers` is used today.

### Tests

- [x] Schema tests: absent `tracker` block → `kind: linear`; explicit `kind: github` accepted; `github.issues` with partial `statusLabels` fills defaults; github block without `issues` still validates.
- [x] Migration tests: `CURRENT_WORKFLOW_VERSION === LATEST_MIGRATION_VERSION === 7`; `fieldsAddedSince(6)` includes the new ids; every v7 field id resolves to a catalogue field (existing sync test should stay green).
- [x] Wizard round-trip test: answers writing `tracker.kind` and `github.issues.*` produce a WORKFLOW.md that re-parses to the same values; Linear answers do not emit github.issues keys.
- [x] wire.ts selection test: `tracker.kind: github` builds the GitHub provider, `linear`/absent builds the Linear resolver. Exercise the GitHub provider's gh-command mapping with a mocked `cmdRunner`.
- [ ] Run `bun run lint` and `bun run test`; do not reduce the coverage threshold.

### Manual / e2e

- [ ] End-to-end demo on a scratch GitHub repo: with `tracker.kind: github`, the agent reads a labelled todo issue, applies the in-progress label, opens a PR, and closes the issue (applies the done label) on completion. Record the run.
- [ ] `bunx openspec validate rlf-234-tracker-kind-config-migration-wizard-pro` passes.
