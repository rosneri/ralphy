# Spec: GitHub issues provider on the generic tracker contract

## ADDED Requirements

### Requirement: GitHub coordinator seam is a named generic-contract factory

The system SHALL produce GitHub's coordinator seam from a single named factory `createGithubTrackerProvider` that returns an `IssueTrackerProvider` (from `@ralphy/tracker`) by delegating to the `gh`-CLI transport, symmetric with `createLinearTrackerProvider`. `wire.ts` MUST consume this factory for the GitHub backend instead of assembling an inline ad-hoc seam object.

#### Scenario: GitHub seam built from the named factory

Given `cfg.tracker.kind` is `"github"`,
when the agent runtime is wired,
then the `IssueTrackerProvider` injected into the coordinator is the value returned by `createGithubTrackerProvider`,
and no inline object literal is used to build the GitHub coordinator seam.

#### Scenario: exactly one createGithubTrackerProvider symbol exists

Given the codebase after this change,
when the source is searched for declarations named `createGithubTrackerProvider`,
then exactly one declaration exists (the contract seam returning `IssueTrackerProvider`),
and the former `gh`-transport factory is exported under a distinct name (`createGithubProvider`).

### Requirement: GitHub fetchComments returns real issue comments

The GitHub provider's `fetchComments(issueId)` MUST return the issue's actual comments by invoking `gh issue view <issueId> --json comments` through the injected transport, mapping each entry to `{ body }`. It MUST NOT return a hard-coded empty array.

#### Scenario: comments are returned for an issue with comments

Given a GitHub issue whose `gh issue view --json comments` yields two comments,
when `fetchComments(issueId)` is called,
then it returns both comment bodies in order.

#### Scenario: issue with no comments yields empty list

Given a GitHub issue whose `gh issue view --json comments` yields no comments (empty or `{"comments":[]}`),
when `fetchComments(issueId)` is called,
then it returns an empty array without throwing.

### Requirement: GitHub fetchReview is intentionally empty and mentions-driven

For the GitHub backend, `fetchReview()` SHALL return an empty array. GitHub emits no `getReview` indicator and the coordinator does not poll `fetchReview`; GitHub review re-engagement flows through `fetchMentions`. The empty return MUST be documented as intentional, not an unfinished stub.

#### Scenario: fetchReview returns empty for GitHub

Given the GitHub coordinator seam,
when `fetchReview()` is called,
then it returns an empty array.

### Requirement: GitHub-specific semantics stay in the GitHub layer

GitHub lifecycle semantics (label-based buckets, "done" = closing the issue) MUST remain inside the GitHub provider layer. This change MUST NOT modify the `IssueTrackerProvider` contract, the coordinator, or other shared runtime abstractions to accommodate GitHub.

#### Scenario: shared contract and coordinator unchanged

Given this change is applied,
when `packages/tracker` and the coordinator are inspected,
then the `IssueTrackerProvider` interface and coordinator polling behavior are unchanged,
and GitHub label/close handling lives only in the GitHub provider files.
