# Tasks for RLF-235

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-235/github-status-as-labels-semantics-per-provider-applymarker and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### Pure helper

- [ ] Add the pure, exported `staleStatusLabels(currentLabels, addLabels, prefix)` helper to `apps/agent/src/agent/wire/tracker/github-tracker-provider.ts` returning the `prefix`-namespaced labels present in `currentLabels` but not in `addLabels`.
- [ ] Add unit tests for `staleStatusLabels`: no stale label, one stale label, ignores non-`status:` labels, excludes the label being re-applied, multiple status markers.

### Vocab & provider

- [ ] Extend `GithubMarkerVocab` with `statusPrefix: string`; default it to `"status:"` inside `createGithubTrackerProvider` when omitted. Standardize the review convention label to `status:in-review`.
- [ ] Rework `applyIndicator`'s add-label fork to compute `staleStatusLabels(issue.labels, action.labels, vocab.statusPrefix)` and emit a single `gh issue edit <id> --add-label <new>` plus `--remove-label <stale…>` (only when stale is non-empty). Leave the close fork and the empty-labels no-op untouched.
- [ ] Confirm `setError` resolves to the `status:error` convention label so it flows through the single-active-status add fork (no special-casing).
- [ ] Reconcile `fetchInProgress` / `fetchReview` membership through `issueMatchesGetIndicator` (imported from `linear-client.ts`) against convention-label `GetIndicator`s, retaining the server-side `--label` narrowing.

### Provider tests

- [ ] Add provider tests asserting the combined `--add-label`/`--remove-label` argv on an in-progress → review transition, and that a fresh transition emits no `--remove-label`.
- [ ] Assert non-status labels (`ralphy:todo`) are never stripped during a status transition.
- [ ] Assert the existing close/comment/`removeIndicator` argv paths are unchanged.

### Harness & contract kit

- [ ] Update `apps/agent/test/harness/fake-github.ts` so its `applyIndicator` add path strips stale status labels via the shared `staleStatusLabels` helper; thread `statusPrefix: "status:"` and `status:in-review` through the GitHub contract adapter.
- [ ] Add a `fake-github` test (and/or contract-kit assertion) walking `todo → in-progress → review → done` and asserting at most one `status:*` label at every open step, and that `done` closes the issue into `fetchDoneCandidates`.
- [ ] Verify the Linear backend still passes the unchanged contract-kit lifecycle cases.

### Gates

- [ ] Run `bun run lint` and fix any findings.
- [ ] Run `bun run test` (or the targeted `apps/agent` suites) green; do not reduce the coverage threshold.
- [ ] Run `bunx openspec validate rlf-235-github-status-as-labels-semantics-per-pr` and ensure it passes.
