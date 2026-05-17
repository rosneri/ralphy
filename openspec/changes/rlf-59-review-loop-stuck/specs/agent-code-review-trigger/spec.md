# agent-code-review-trigger — single-fire per reviewer activity

## MODIFIED Requirements

### Requirement: `scanCodeReview` MUST NOT re-fire on the same reviewer-activity timestamp within a single agent process

The code-review trigger scan in `apps/agent/src/agent/wire.ts` MUST debounce
not only via the Linear `🔁 Ralph picked up …` comment, but also via a
process-local map keyed by PR URL that records the
`newestReviewerActivity` ISO timestamp of the last trigger Ralph queued.
When the freshly-computed `newestReviewerActivity` is less than or equal to
the recorded value for that PR URL, the scan MUST return `null` without
queuing a new review trigger, regardless of whether the Linear pickup
comment exists.

The recorded value MUST be set immediately when the trigger is returned
(before the worker spawns / before the pickup comment posts), so a poll
that lands during worker prep cannot re-fire the same activity.

#### Scenario: Same reviewer comment does not re-trigger across polls when `postComments: false`

- **Given** `linear.postComments` is `false`
- **And** a tracked PR has an unresolved reviewer comment at time `T`
- **When** the agent polls twice in succession
- **Then** `scanCodeReview` returns a trigger on the first poll
- **And** returns `null` on the second poll
- **And** no Linear `🔁 Ralph picked up` comment is required for the dedupe

#### Scenario: A genuinely new reviewer comment still triggers

- **Given** `scanCodeReview` previously fired for a reviewer comment at `T1`
- **And** the in-process map records `T1` for that PR URL
- **When** a fresh reviewer comment arrives at `T2 > T1`
- **And** the agent polls
- **Then** `scanCodeReview` returns a new trigger
- **And** the in-process map is updated to `T2`

#### Scenario: Pickup-comment post failure no longer causes a re-fire loop

- **Given** `linear.postComments` is `true`
- **And** the Linear API call posting `🔁 Ralph picked up …` fails
- **When** the agent polls again before any new reviewer activity
- **Then** `scanCodeReview` returns `null` (the in-process map blocks the
  re-fire even though the Linear sentinel is missing)
