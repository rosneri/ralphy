# agent-list — PR status visibility

## ADDED Requirements

### Requirement: agent list MUST surface PR conflicts and CI failures

The `agent list` command MUST resolve, for every Linear ticket it prints, the
status of the associated GitHub PR (if one exists) and render conflict / CI
state inline so that operators can spot blocked PRs without opening GitHub.

The unified table MUST sort rows so that the most-blocking PRs appear at the
top, in this order: (1) conflicted PRs with auto-merge enabled, (2) failing-CI
PRs with auto-merge enabled, (3) any conflicted PR, (4) any failing-CI PR,
(5) everything else. Within a tier, PRs MUST be ordered by `createdAt` ascending
so the oldest blocked PR is most visible.

A `gh` failure for a single PR MUST NOT abort the whole listing; the row MUST
render with a `?` marker and sort into tier 5.

#### Scenario: a conflicted auto-merge PR sorts above a failing-CI auto-merge PR

- **Given** ticket A has a PR with `mergeable=CONFLICTING` and `autoMergeRequest!=null`
- **And** ticket B has a PR with passing checks marked `mergeable=MERGEABLE` and `autoMergeRequest=null`
- **And** ticket C has a PR with failing CI and `autoMergeRequest!=null`
- **When** the operator runs `agent list`
- **Then** the printed order is A (✗conflict auto-merge), C (✗ci auto-merge), B (ok)

#### Scenario: gh outage on one PR doesn't break the table

- **Given** five tickets each have a PR
- **And** `gh pr view` fails for one of those PRs (e.g. network error)
- **When** the operator runs `agent list`
- **Then** all five rows are still printed
- **And** the failing row shows a `?` PR-Status marker and falls into tier 5

#### Scenario: ticket with no PR is still listed

- **Given** a Linear ticket has no GitHub PR attachment
- **When** the operator runs `agent list`
- **Then** the row prints with `(no PR)` in the PR-URL column and tier 5 sort placement
