# RLF-229: Add GitHub issues provider on generic tracker contract

Source: [RLF-229](https://linear.app/neriros/issue/RLF-229/add-github-issues-provider-on-generic-tracker-contract)
Status: Todo
Assignee: Neriya Rosner
Labels: auto-merge

## Why

The generic `IssueTrackerProvider` contract (`@ralphy/tracker`) exists and Linear is wrapped behind a clean `createLinearTrackerProvider` seam, but GitHub is not yet a first-class implementation of that contract. Today `wire.ts` assembles GitHub's coordinator seam as an **inline ad-hoc object** layered over the `gh`-CLI transport, and a dedicated generic-contract implementation (`github-tracker-provider.ts`) exists but is **orphaned** — only its own test and the test harness reference it.

This leaves two problems:

1. **A real functional gap.** The inline GitHub seam stubs `fetchComments` to `[]`. The coordinator calls `fetchComments(issue.id)` to back "started"-idempotency (coordinator.ts:1817), so under the GitHub backend that check can never see prior progress comments — Linear does not have this gap.
2. **Drift and duplication.** Two functions named `createGithubTrackerProvider` exist with different return types (the wired transport factory in `github.ts` returns `TrackerProvider`; the orphaned one in `github-tracker-provider.ts` returns `IssueTrackerProvider`). GitHub is the only backend whose contract seam is not a named factory symmetric with Linear's.

RLF-229 makes GitHub a genuine `GithubTrackerProvider` on the generic seam: one named contract-seam factory, wired into the runtime, with no functionally-meaningful stubs — while keeping GitHub-specific semantics (no status field, "done" = close) inside the GitHub layer and out of shared runtime abstractions.

## What Changes

- Promote GitHub's coordinator seam from the inline object in `wire.ts` to a named factory `createGithubTrackerProvider` (returning `IssueTrackerProvider`), symmetric with `createLinearTrackerProvider`. The factory delegates to the existing `gh`-CLI transport, mirroring how the Linear seam delegates to its resolvers.
- Implement a real `fetchComments` for GitHub (`gh issue view <id> --json comments`) on the transport, and wire it through the seam, replacing the `fetchComments: async () => []` stub so started-idempotency works under the GitHub backend.
- Keep `fetchReview` returning `[]` for GitHub (documented): GitHub emits no `getReview` indicator and the coordinator does not poll `fetchReview` today; GitHub review re-engagement flows through `fetchMentions`. This avoids inventing review semantics for GitHub.
- Resolve the `createGithubTrackerProvider` name collision: rename the `gh`-CLI **transport** factory in `github.ts` to `createGithubProvider`, so the contract-seam factory owns the `createGithubTrackerProvider` name. Update `wire.ts` and tests accordingly.
- Reconcile the orphaned `github-tracker-provider.ts`: retain its pure, reused helpers (`mapGithubIssue`, `flattenLabel`, `githubIndicatorAction`, `staleStatusLabels`) and fold its production factory into the wired delegating seam so there is exactly one GitHub contract-seam factory. Update the test harness (`fake-github.ts`) and tests to import helpers from their final home.
- No changes to shared runtime abstractions, the `IssueTrackerProvider` contract, or the coordinator — GitHub-specific behavior stays in the GitHub provider layer.

## Acceptance Criteria

- GitHub's coordinator seam is produced by a single named `createGithubTrackerProvider` factory returning `IssueTrackerProvider`, consumed by `wire.ts`; the inline ad-hoc seam object is gone.
- Exactly one symbol named `createGithubTrackerProvider` exists in the codebase (the contract seam); the `gh`-transport factory is renamed (`createGithubProvider`) and there is no duplicate-declaration conflict.
- Under the GitHub backend, `fetchComments(issueId)` returns the issue's real comments via `gh issue view`, and started-idempotency works the same way it does for Linear.
- `fetchReview` for GitHub returns `[]` and is documented as not-polled / mentions-driven; no GitHub review semantics are invented.
- GitHub-specific semantics (label buckets, "done" = close) remain inside the GitHub provider; `@ralphy/tracker`, the coordinator, and other shared runtime code are unchanged in behavior.
- The provider-contract test suite passes for the GitHub backend; `bun run lint` and `bun run test` pass; coverage threshold is not reduced.

## Additional instructions

You are working on RLF-229: Add GitHub issues provider on generic tracker contract.

Labels: auto-merge

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
