# mergeability-retry — robust UNKNOWN handling in PR scanner and conflict-fix verify

## MODIFIED Requirements

### Requirement: PR scanner retries on transient errors rather than aborting immediately

The PR scanner in `checkPrStatus` MUST continue to the next retry attempt (up to
3 total) when `gh pr view` throws, rather than returning `"unknown"` immediately.
The diagnostic log MUST include the attempt number. After exhausting all attempts
the scanner MUST return `status: "unknown"` so the coordinator rechecks on the
next poll cycle.

#### Scenario: transient error on first attempt, MERGEABLE on second

- **Given** the PR scanner calls `gh pr view` for an open PR
- **And** the first call throws with "HTTP 502"
- **And** the second call returns `mergeable: "MERGEABLE"`
- **Then** the scanner returns `status: "mergeable"` (not `"unknown"`)
- **And** the diagnostic log contains the error message with the attempt number

#### Scenario: error on all three attempts

- **Given** the PR scanner calls `gh pr view` for an open PR
- **And** all three attempts throw with a network error
- **Then** the scanner returns `status: "unknown"`
- **And** the coordinator rechecks the PR on the next poll cycle

### Requirement: Conflict-fix verify path retries UNKNOWN mergeability before giving up

After a conflict-fix worker exits 0, the verify path MUST call `fetchPrStatus`
up to 3 additional times (default 2000 ms delay) when mergeability is `UNKNOWN`
before leaving the conflict label in place. If a retry resolves to `MERGEABLE`,
`clearConflicted` MUST be invoked immediately without waiting for the next poll.

#### Scenario: UNKNOWN resolves to MERGEABLE within retries

- **Given** a conflict-fix worker exits 0
- **And** the first `fetchPrStatus` call returns `mergeable: "UNKNOWN"`
- **And** a subsequent retry returns `mergeable: "MERGEABLE"`
- **Then** `clearConflicted` is invoked exactly once
- **And** a green log line is emitted
- **And** the conflict label is removed without waiting for the next poll cycle

#### Scenario: UNKNOWN persists through all retries

- **Given** a conflict-fix worker exits 0
- **And** all `fetchPrStatus` calls (1 initial + 3 retries) return `mergeable: "UNKNOWN"`
- **Then** `clearConflicted` is NOT invoked
- **And** a yellow warning log is emitted
- **And** the coordinator will recheck on the next poll cycle
