# Design for RLF-235 — GitHub status-as-labels: single active status label

## Goal

Make the GitHub provider treat the `status:*` label namespace as a single-valued
status field: applying a status transition adds the new convention label and
removes the prior one in the same `gh issue edit`, so an open issue carries **at
most one** `status:*` label. Keep the rule pure and shared between the real
provider and the FakeGithub harness.

## Current behavior (baseline)

`github-tracker-provider.ts`:

- `githubIndicatorAction(set, op)` — pure classifier returning `{kind:"close"}`
  for a done indicator, else `{kind:"add-label"|"remove-label", labels}`.
- `applyIndicator` — for the add fork, runs `gh issue edit <id> --add-label
<labels…>` (additive only; **never strips a prior status label**).
- `removeIndicator` — runs `gh issue edit <id> --remove-label <labels…>`.
- `fetchInProgress` / `fetchReview` — `gh issue list --state open --label <x>`,
  then `map(mapGithubIssue)`. No reuse of `issueMatchesGetIndicator`.
- `fetchTodo` — lists open + selection label, then drops issues carrying any
  `vocab.lifecycleLabels` (negative exclusion).

`FakeGithub` (`test/harness/fake-github.ts`) mirrors this and reuses
`githubIndicatorAction`; its `addLabels` simply appends — no stripping.

## Changes

### 1. New pure helper: `staleStatusLabels`

```ts
/** Existing `status:*` labels on the issue that must be stripped when the given
 *  status labels are applied, to preserve the single-active-status invariant.
 *  Returns labels under `prefix` that are present but not among `addLabels`. */
export function staleStatusLabels(
  currentLabels: string[],
  addLabels: string[],
  prefix: string,
): string[] {
  const adding = new Set(addLabels);
  return currentLabels.filter((l) => l.startsWith(prefix) && !adding.has(l));
}
```

- Pure, exported, unit-tested in isolation.
- Used by both the real `applyIndicator` and `FakeGithub.applyIndicator` so the
  invariant rule lives in exactly one place (same pattern the codebase already
  uses for `githubIndicatorAction`).

### 2. `GithubMarkerVocab` gains `statusPrefix`

```ts
export interface GithubMarkerVocab {
  selectionLabel: string;
  inProgressLabel: string; // "status:in-progress"
  reviewLabel: string; // "status:in-review"  (standardized)
  lifecycleLabels: string[];
  /** Namespace identifying single-valued status labels. Default "status:". */
  statusPrefix: string;
}
```

`statusPrefix` defaults to `"status:"` when a caller omits it (handled in
`createGithubTrackerProvider`, not via a partial-type leak).

### 3. `applyIndicator` add-label fork strips the prior status label

```ts
applyIndicator: async (issue, ind) => {
  const action = githubIndicatorAction(ind, "add");
  if (action.kind === "close") { await run(["issue", "close", issue.id]); return; }
  if (action.labels.length === 0) return;
  const stale = staleStatusLabels(issue.labels, action.labels, vocab.statusPrefix);
  const args = ["issue", "edit", issue.id, "--add-label", action.labels.join(",")];
  if (stale.length > 0) args.push("--remove-label", stale.join(","));
  await run(args);
},
```

- Single `gh issue edit` invocation carries both flags — atomic, one network
  round-trip. `gh issue edit` accepts `--add-label` and `--remove-label`
  together.
- Non-status labels (e.g. a future `ralphy:*` marker) never appear in `stale`
  because the filter is gated on `startsWith(prefix)`.
- The done fork and the `labels.length === 0` no-op are unchanged.

### 4. `setError` is a status convention label

`setError` maps to `status:error` (a `status:` label), so applying it strips any
prior `status:*` label via the same fork. No special-casing — it falls out of the
generic add-label path. The contract adapter's `set.error` already uses
`status:error`; `lifecycleLabels` keeps it for the `fetchTodo` exclusion.

### 5. `fetchInProgress` / `fetchReview` reconcile via `issueMatchesGetIndicator`

Keep the server-side `--label` narrowing (cheap, fewer rows) but make the bucket
membership decision go through the shared pure matcher so GitHub and Linear share
one definition of "matches this indicator":

```ts
const IN_PROGRESS_GET: GetIndicator = { filter: [{ type: "label", value: vocab.inProgressLabel }] };
fetchInProgress: async () => {
  const issues = await listIssues(["--state", "open", "--label", vocab.inProgressLabel]);
  return issues.filter((i) => issueMatchesGetIndicator(i, IN_PROGRESS_GET));
},
```

`issueMatchesGetIndicator` is imported from `linear-client.ts` (already pure, no
network). Same shape for `fetchReview` with the review label.

### 6. `FakeGithub` enforces the invariant

`FakeGithub.applyIndicator`'s add path computes `staleStatusLabels(rec.issue.labels,
action.labels, "status:")` and removes those before adding, mirroring the real
provider. The GitHub contract adapter passes `statusPrefix: "status:"` and the
`status:in-review` review label so both backends assert identically.

## Data flow (todo → in-progress → review → done)

| Step        | Indicator applied               | gh call                                                               | `status:*` labels after               |
| ----------- | ------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| pickup      | (none; selection `ralphy:todo`) | —                                                                     | none                                  |
| in-progress | `status:in-progress`            | `edit --add-label status:in-progress`                                 | `status:in-progress`                  |
| review      | `status:in-review`              | `edit --add-label status:in-review --remove-label status:in-progress` | `status:in-review`                    |
| done        | `status:done`                   | `issue close`                                                         | (closed; labels irrelevant to bucket) |
| error path  | `status:error`                  | `edit --add-label status:error --remove-label status:in-progress`     | `status:error`                        |

At every open step the issue carries at most one `status:*` label.

## Edge cases

- **Re-applying the current status** (e.g. `status:in-progress` when already
  in-progress): `staleStatusLabels` excludes the label being added, so nothing is
  stripped — `--remove-label` is omitted, the edit is an idempotent add.
- **No prior status label** (fresh todo → in-progress): `stale` is empty, no
  `--remove-label` flag, behaves exactly as today.
- **done fork**: closing does not strip status labels; closed issues are
  doneCandidates by state, not by label, so a leftover `status:*` label on a
  closed issue is harmless. We intentionally do not add an extra edit before
  close (keeps it one call; matches existing behavior).
- **Multiple status markers in one `SetIndicator`** (unusual): all are added and
  all are excluded from `stale`, so only _other_ status labels are stripped.
- **Non-status labels** (selection `ralphy:todo`, future `ralphy:*`): never
  considered stale, never stripped — only the `status:` namespace is single-valued.
- **`removeIndicator`** is unchanged: it strips exactly the markers it is given
  (used for `clearReview`). The single-active invariant is owned by `applyIndicator`
  so it holds regardless of whether the coordinator also calls `removeIndicator`.

## Files to touch

- `apps/agent/src/agent/wire/tracker/github-tracker-provider.ts` — add
  `staleStatusLabels`, `statusPrefix` on vocab, rework `applyIndicator`, reconcile
  `fetchInProgress`/`fetchReview` via `issueMatchesGetIndicator`.
- `apps/agent/test/harness/fake-github.ts` — consume `staleStatusLabels`; pass
  `statusPrefix`/`status:in-review` through the contract adapter.
- `apps/agent/src/agent/wire/tracker/__tests__/github-tracker-provider.test.ts` —
  unit tests for `staleStatusLabels` and the combined add/remove argv.
- `apps/agent/test/harness/__tests__/fake-github.test.ts` — single-active-status
  invariant across a lifecycle walk.
- (no change to `linear-client.ts` — `issueMatchesGetIndicator` is reused as-is.)

## Risks / non-goals

- **Non-goal:** changing `fetchTodo`'s exclusion model or introducing a
  `status:todo` label — the selection label + exclusion filter stays as-is.
- **Non-goal:** Projects v2 (M5) status field.
- **Risk:** the existing `fetchInProgress`/`fetchReview` tests assert argv; they
  keep passing because the server-side `--label` flag is retained. New assertions
  cover the post-filter.
