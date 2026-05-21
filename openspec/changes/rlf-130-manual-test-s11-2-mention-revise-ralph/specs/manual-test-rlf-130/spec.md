# Manual test RLF-130 — Mention "revise" beats ralph:approved with conflict

## ADDED Requirements

### Requirement: A `@ralphy revise` mention MUST beat a concurrent `ralph:approved` label even when the PR is conflicting

The revise mention MUST take precedence when the confirmation gate sees both an approval signal (`ralph:approved` label applied) and a revise-intent mention (e.g. a PR/Linear comment of `@ralphy revise this`) within the same evaluation window. The change MUST return to the design /
revise path and the worker MUST NOT attempt to merge the PR — even when
the PR is in a conflicting (mergeable=`CONFLICTING`) state.

The approval is treated as superseded by the later revise request: a
subsequent `ralph:approved` toggle alone is insufficient to advance the
change while an unresolved revise mention is outstanding.

#### Scenario: confirm + mention variant — revise wins over approved with a conflict

- **Given** an issue in the `ralphy-rlf87-test` repo running the
  `WORKFLOW.confirm.md` + `WORKFLOW.mention.md` variant
- **And** the PR for that issue is conflicting against its base branch
- **And** a reviewer posts `@ralphy revise this` on the PR
- **And** the `ralph:approved` label is flipped on then off around the
  comment (label race)
- **When** the coordinator next polls
- **Then** Row 1 (mention=revise) of the precedence matrix wins
- **And** the change is sent back to design / revise rather than merged
- **And** no merge attempt is recorded for the conflicting PR

#### Scenario: regression — approved short-circuits the revise

- **Given** the same setup as the previous scenario
- **When** the agent treats the `ralph:approved` label as authoritative
  and ignores the revise mention
- **Then** the test FAILS and the result file MUST flag the regression
  signature "Approved short-circuits the revise — agent merges instead
  of revising"
- **And** a fix ticket MUST be filed as a child of RLF-99 rather than
  patched in this change
