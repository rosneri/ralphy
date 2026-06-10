# RLF-235: GitHub status-as-labels semantics (per-provider applyMarker)

Source: [RLF-235](https://linear.app/neriros/issue/RLF-235/github-status-as-labels-semantics-per-provider-applymarker)
Status: Done

> **Superseded:** shipped in PR #390 against the contract-kit
> `github-tracker-provider.ts`, but RLF-229 (PR #398) deleted that provider's
> self-`gh`-calling body days later. The production GitHub transport
> (`agent/wire/tracker/github.ts`) now does `--add-label` only — no
> stale-status stripping — and its status labels default to the `ralph:*`
> namespace, not `status:*`. The single-active-status invariant survives only
> in the pure `staleStatusLabels` helper and the FakeGithub test harness, so
> the design below no longer describes the shipped GitHub path.

## Why

Until Projects v2 lands (M5), GitHub has no first-class "status" field — every
lifecycle position except _done_ is just a label. The backend-neutral provider
contract kit already proves `github-tracker-provider.ts` can stand alongside the
Linear client, but the GitHub provider's `applyIndicator` is **purely additive**:
it `--add-label`s the new status label and never strips the previous one. After a
`todo → in-progress → review` walk, an issue accumulates `status:in-progress`,
`status:in-review`, … all at once. Bucketing then survives only because
`fetchTodo` does negative exclusion filtering — there is no clean "the issue is in
exactly one status" invariant the way a real status field gives Linear.

RLF-235 makes GitHub status-as-labels behave like a single-valued status: a
status transition applies the new convention label **and** removes the prior
status label in the same edit, so an issue always carries at most one active
`status:*` label. This keeps label state legible to humans on the repo, makes the
contract-kit status-transition cases pass on the same invariant as Linear, and
keeps the rule in one pure place shared by the real provider and the FakeGithub
harness.

## What Changes

- Add a pure `staleStatusLabels(currentLabels, addLabels, prefix)` helper to
  `github-tracker-provider.ts` that, given the labels already on an issue and the
  status labels about to be added, returns the existing `status:*` labels that
  must be stripped to preserve the single-active-status invariant.
- Extend `GithubMarkerVocab` with a `statusPrefix` (default `"status:"`) naming
  the convention namespace, and standardize the review convention label to
  `status:in-review`.
- Rework `applyIndicator`'s add-label fork so that when the applied marker is a
  status convention label it issues a single `gh issue edit … --add-label <new>
--remove-label <stale…>`, removing any other `status:*` label already on the
  issue. The done fork (`gh issue close`) and the comment/no-op paths are
  unchanged.
- Map `setError` onto the `status:error` convention label so it participates in
  the single-active-status invariant (an errored issue carries `status:error`
  and no other status label).
- Have `fetchInProgress` / `fetchReview` reconcile their listed issues through the
  pure `issueMatchesGetIndicator` (reused from `linear-client.ts`) against
  convention-label `GetIndicator`s, so the buckets are defined by the shared pure
  matcher rather than only by a server-side `--label` flag.
- Update `FakeGithub` to enforce the same single-active-status invariant (reusing
  the shared `staleStatusLabels` helper) so the contract kit asserts the
  invariant identically against both the real provider and the fake.

## Acceptance Criteria

- [ ] Contract-kit status-transition cases stay green for GitHub
      (`todo → in-progress → review → done`) with **exactly one** active `status:*`
      label on the issue at every step.
- [ ] `applyIndicator(status:in-review)` on an issue carrying `status:in-progress`
      results in `status:in-review` present and `status:in-progress` absent, via a
      single `gh issue edit` invocation carrying both `--add-label` and
      `--remove-label`.
- [ ] `getInProgress` returns issues carrying the in-progress convention label,
      matched through `issueMatchesGetIndicator`.
- [ ] `setError` leaves the issue carrying `status:error` and no other `status:*`
      label.
- [ ] `staleStatusLabels` is pure and unit-tested; both the real provider and
      `FakeGithub` consume it so the rule lives in one place.
- [ ] `bun run lint` and `bun run test` pass; coverage threshold is not lowered.

## Test plan

- Unit tests for `staleStatusLabels` (no stale, one stale, ignores non-`status:`
  labels, ignores the label being re-applied).
- Provider tests asserting the combined `--add-label`/`--remove-label` argv on a
  status transition and the unchanged close/comment paths.
- Contract-kit / FakeGithub tests asserting at-most-one `status:*` label across a
  full lifecycle walk.
- Live demo: status transitions visible as single-label changes on a scratch repo.

## Key files

- `apps/agent/src/agent/wire/tracker/github-tracker-provider.ts`
- `apps/agent/src/shared/capabilities/linear-client.ts` (`issueMatchesGetIndicator` — reused, pure)
- `apps/agent/test/harness/fake-github.ts`
- `apps/agent/test/harness/provider-contract.ts`

## Additional instructions

You are working on RLF-235: GitHub status-as-labels semantics (per-provider applyMarker).

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
