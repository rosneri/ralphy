# RLF-234: tracker.kind config + migration + wizard + provider selection

Source: [RLF-234](https://linear.app/neriros/issue/RLF-234/trackerkind-config-migration-wizard-provider-selection)
Status: Todo
Labels: approved

## Why

Ralphy's issue tracker is hard-wired to Linear: every poll fetches work items through `createLinearResolvers` / `fetchOpenIssues`, and there is no seam to swap the tracker. To demo Ralphy end-to-end against a plain GitHub repository (read an issue, label it in-progress, open a PR, close the issue on done) we need a configurable tracker kind, a migration that keeps every existing Linear config working untouched, a wizard step to pick the tracker, and a provider-selection point in `wire.ts` that routes issue fetches and state transitions to either Linear or GitHub.

`CURRENT_WORKFLOW_VERSION` is **already 6**, so this change bumps it to **7** (the original deep plan said "→ 6" — that was stale).

## What Changes

- Add a `tracker: { kind: "linear" | "github" }` block to `WorkflowConfigSchema`, defaulting to `linear`, so an absent block is exactly today's behavior.
- Extend the existing `github` schema block (currently `base_branch` / `auto_merge_strategy`) with an `issues` sub-block — `repo`, `label`, `assignee`, and a `statusLabels: { inProgress, done, error }` convention map — configuring GitHub-issue tracking.
- Bump `CURRENT_WORKFLOW_VERSION` 6 → 7 and register a version-7 migration in `apps/init/src/migrations.ts` whose `fields` introduce `tracker.kind` (and the `github.issues.*` ids); existing files migrate to `tracker.kind: linear` with no behavior change. Keep `LATEST_MIGRATION_VERSION` in sync (a test asserts this).
- Add a `tracker.kind` select question to the wizard (`packages/workflow/src/fields.ts`) plus `github.issues.*` follow-up questions gated (`when`) on `tracker.kind === "github"`, and add the new keys to `DEFAULT_WORKFLOW_MD` so descriptions stamp correctly.
- Extract a `TrackerProvider` interface from the operations `wire.ts` already consumes off `createLinearResolvers` (`fetchByGet`, `applyIndicator`, `removeIndicator`, `applyMarker`, label resolution, done-candidate discovery). Make the existing Linear resolver conform (reference implementation, zero behavior change) and add a `createGithubTrackerProvider` implementing the same surface against the `gh` CLI. `wire.ts` selects the provider by `cfg.tracker.kind`.

## Acceptance Criteria

- [ ] Existing Linear configs (no `tracker` block) migrate to `kind: linear` and resolve to the Linear provider with **no behavior change** — all existing agent tests pass unchanged.
- [ ] A config with `tracker.kind: github` resolves to the GitHub tracker provider in `wire.ts`.
- [ ] Schema validation + migration unit tests (v6 → v7), and a wizard round-trip test that writes and re-reads `tracker.kind` and the `github.issues.*` keys.
- [ ] `CURRENT_WORKFLOW_VERSION === LATEST_MIGRATION_VERSION === 7` (sync test green).
- [ ] **End-to-end demo on a scratch GitHub repo:** the agent reads an issue carrying the todo label, applies the in-progress label, opens a PR, and closes the issue (applies the done label) when work completes.
- [ ] `bun run lint` and `bun run test` pass; coverage threshold is not reduced.

## Additional instructions

You are working on RLF-234: tracker.kind config + migration + wizard + provider selection.

Labels: approved

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
