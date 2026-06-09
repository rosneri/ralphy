# Design for RLF-229 — GitHub issues provider on the generic tracker contract

## Background / current state

The generic seam every backend implements lives in `packages/tracker/src/provider.ts`:

```ts
interface IssueTrackerProvider {
  fetchTodo;
  fetchInProgress;
  fetchReview;
  fetchMentions;
  fetchDoneCandidates;
  fetchComments;
  applyIndicator;
  removeIndicator;
  postComment;
}
```

`CoordinatorDeps` extends `IssueTrackerProvider`, so the coordinator depends only on this shape.

Linear is wired symmetrically through two factories:

- `apps/agent/src/agent/wire/tracker/linear.ts` — `createLinearProvider` → wire-local `TrackerProvider` (transport + `resolvers`), used by spawn / confirmation / baseline / mentions.
- `apps/agent/src/agent/wire/tracker/linear-tracker-provider.ts` — `createLinearTrackerProvider({ resolvers, fetchMentions, … })` → `IssueTrackerProvider`, the **coordinator seam**, built by _delegating_ to the transport's resolvers.

GitHub is **not** symmetric:

- `apps/agent/src/agent/wire/tracker/github.ts` — `createGithubTrackerProvider` (misnamed) → wire-local `TrackerProvider & { listOpenIssues, repo }`. This is the live transport. Also exports `githubIndicators`.
- `apps/agent/src/agent/wire/tracker/github-tracker-provider.ts` — a second `createGithubTrackerProvider` → `IssueTrackerProvider`, a standalone implementation that issues its own `gh` calls. **Orphaned**: referenced only by its own test and (for pure helpers) by `fake-github.ts`.
- `apps/agent/src/agent/wire.ts` (~lines 322–336) — builds GitHub's `IssueTrackerProvider` **inline**, delegating to the `github.ts` transport, with two stubs: `fetchReview: async () => []` and `fetchComments: async () => []`.

### Why the stubs matter (and which one is real)

- `fetchReview` — the coordinator does **not** poll `fetchReview` today (see coordinator.ts docs near line 273); review re-engagement flows through `fetchMentions`. `githubIndicators` emits no `getReview`. → returning `[]` is correct and should stay, documented.
- `fetchComments` — the coordinator **does** call `fetchComments(issue.id)` (coordinator.ts:1817) to back "started"-idempotency. The `[]` stub means the GitHub backend can never detect prior progress comments. → **genuine gap to fix.**

## Approach

Make GitHub symmetric with Linear: a single named contract-seam factory, `createGithubTrackerProvider`, that returns `IssueTrackerProvider` by **delegating to the `gh` transport** (the same delegation pattern as `createLinearTrackerProvider`), with a real `fetchComments`. Resolve the name collision by renaming the transport factory.

Chosen over wiring the orphaned standalone `github-tracker-provider.ts` directly, because that file re-implements its own `gh` fetch calls (duplicating the transport) and takes a different input shape (`{ runner, cwd, repo, vocab }`) — asymmetric with Linear and a larger, drift-prone surface. We keep its pure helpers and discard its standalone factory body.

## Files to touch

| File                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/agent/src/agent/wire/tracker/github.ts`                                 | Rename transport factory `createGithubTrackerProvider` → `createGithubProvider`. Add a transport method `fetchComments(issueId)` running `gh issue view <id> --json comments`. Keep `githubIndicators`, `listOpenIssues`, `repo`.                                                                                                                                                          |
| `apps/agent/src/agent/wire/tracker/github-tracker-provider.ts`                | Becomes the **contract-seam factory**: export `createGithubTrackerProvider(input) → IssueTrackerProvider` that delegates to the transport `provider` + `indicators` + `fetchMentions` (mirrors `createLinearTrackerProvider`). Retain pure helpers (`mapGithubIssue`, `flattenLabel`, `githubIndicatorAction`, `staleStatusLabels`). Remove the standalone self-`gh`-calling factory body. |
| `apps/agent/src/agent/wire.ts`                                                | Import `createGithubProvider` (transport) and `createGithubTrackerProvider` (seam). Replace the inline `tracker` object for the GitHub branch with a call to `createGithubTrackerProvider({ provider, indicators, excludeFromTodo, fetchMentions, … })`.                                                                                                                                   |
| `apps/agent/src/agent/wire/tracker/__tests__/github.test.ts`                  | Update references to the renamed transport factory; add a `fetchComments` test.                                                                                                                                                                                                                                                                                                            |
| `apps/agent/src/agent/wire/tracker/__tests__/github-tracker-provider.test.ts` | Rework to test the delegating seam (scripted transport) instead of the standalone gh-calling factory; assert `fetchComments` returns real comments and `fetchReview` returns `[]`.                                                                                                                                                                                                         |
| `apps/agent/test/harness/fake-github.ts`                                      | Update helper import path if helpers move; ensure it still satisfies `IssueTrackerProvider` incl. `fetchComments`.                                                                                                                                                                                                                                                                         |

No changes to `packages/tracker`, the coordinator, or other shared runtime code.

## Data flow (GitHub backend, after change)

```
wire.ts
  ├─ provider      = createGithubProvider({ issues, cmdRunner, projectRoot, diag })   // transport
  ├─ fetchMentions = createGithubMentionScanner({ …, listOpenIssues: provider.listOpenIssues, repo: provider.repo })
  └─ tracker       = createGithubTrackerProvider({ provider, indicators, excludeFromTodo, fetchMentions })
        fetchTodo           → provider.fetchByGet(getTodo, excludeFromTodo)
        fetchInProgress     → provider.fetchByGet(getInProgress, unionMarkers(setError))
        fetchReview         → []                            // not polled; mentions-driven
        fetchDoneCandidates → provider.fetchDoneCandidates()
        fetchComments       → provider.fetchComments(id)    // gh issue view --json comments
        applyIndicator      → provider.applyIndicator
        removeIndicator     → provider.removeIndicator
        postComment         → provider.applyMarker(issue, { type: "comment", value: body })
        fetchMentions       → injected scanner
  → CoordinatorDeps (extends IssueTrackerProvider)
```

## Edge cases

- **Issue with no comments** — `gh issue view <id> --json comments` returns `{"comments":[]}` (or empty stdout); mapper yields `[]`. Guard `JSON.parse(stdout || "{}")`.
- **`gh` not authenticated / repo unresolved** — transport already surfaces errors via `CmdRunner`; `fetchComments` does not add new auth, reusing the existing runner/env.
- **`issue.id` format** — GitHub provider uses the bare issue number as `id` (`mapGithubIssue` → `String(number)`), so `gh issue view <id>` resolves directly.
- **Name-collision regression** — repo has a pre-PR hook that blocks duplicate same-name declarations; after the rename there must be exactly one `createGithubTrackerProvider`. Grep before pushing.
- **Linear path untouched** — only the GitHub branch of the `tracker` selection changes; the Linear `createLinearTrackerProvider` call is unchanged.
- **`fetchReview` staying empty** — keep the explanatory comment so a future reader does not mistake it for an unfinished stub; it is intentional and consistent with Linear's polling model.

## Out of scope

- Full GitHub mention scanning beyond the existing `createGithubMentionScanner` (already wired).
- Any change to the `IssueTrackerProvider` contract or coordinator polling behavior.
- GitHub Projects / status-field semantics — GitHub lifecycle stays label-based.
