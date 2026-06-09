# github-status-labels — single active status label per issue

## ADDED Requirements

### Requirement: The GitHub tracker MUST keep at most one active status label per issue

The GitHub tracker provider (`apps/agent/src/agent/wire/tracker/github-tracker-provider.ts`) MUST treat the `status:` label namespace as a single-valued status field. When `applyIndicator` adds a status convention label (a label under the configured `statusPrefix`, default `status:`) to an issue, it MUST remove every other `status:`-prefixed label already on that issue in the same `gh issue edit` invocation, so that an open issue carries at most one active `status:*` label at any time.

The stripping rule MUST be a pure, exported helper `staleStatusLabels(currentLabels, addLabels, prefix)` that returns the labels under `prefix` present in `currentLabels` but not in `addLabels`. Both the real provider and the `FakeGithub` harness MUST consume this single helper so the rule lives in one place. Labels outside the `statusPrefix` namespace (e.g. the `ralphy:todo` selection label) MUST never be stripped.

#### Scenario: Transition from in-progress to review strips the prior status label

- **Given** an open issue carrying the `status:in-progress` label
- **When** `applyIndicator` is called with the `status:in-review` status marker
- **Then** a single `gh issue edit <id> --add-label status:in-review --remove-label status:in-progress` is run
- **And** after the call the issue carries `status:in-review` and not `status:in-progress`

#### Scenario: Applying a status to a fresh issue adds no remove flag

- **Given** an open issue carrying no `status:*` label (only the selection label)
- **When** `applyIndicator` is called with the `status:in-progress` marker
- **Then** the `gh issue edit` invocation carries `--add-label status:in-progress` and no `--remove-label` flag

#### Scenario: Re-applying the current status is an idempotent add

- **Given** an open issue already carrying `status:in-progress`
- **When** `applyIndicator` is called again with the `status:in-progress` marker
- **Then** `staleStatusLabels` returns no labels and the `gh issue edit` invocation carries no `--remove-label` flag

#### Scenario: Non-status labels are never stripped

- **Given** an open issue carrying the selection label `ralphy:todo` and `status:in-progress`
- **When** `applyIndicator` is called with the `status:in-review` marker
- **Then** only `status:in-progress` is passed to `--remove-label`
- **And** `ralphy:todo` remains on the issue

### Requirement: setError MUST place the issue in a single status:error state

The GitHub tracker's `setError` indicator MUST map onto the `status:error` convention label. Applying `setError` MUST remove any other `status:*` label already on the issue via the single-active-status rule, leaving the issue carrying `status:error` and no other status label.

#### Scenario: Error from in-progress leaves only status:error

- **Given** an open issue carrying `status:in-progress`
- **When** `applyIndicator` is called with the `setError` (`status:error`) marker
- **Then** after the call the issue carries `status:error` and not `status:in-progress`

### Requirement: GitHub fetch buckets MUST decide membership via the shared pure matcher

`fetchInProgress` and `fetchReview` MUST decide bucket membership through the shared pure `issueMatchesGetIndicator` (from `apps/agent/src/shared/capabilities/linear-client.ts`) against convention-label `GetIndicator`s, so GitHub and Linear share one definition of "matches this indicator". A server-side `--label` narrowing on `gh issue list` MAY be retained as an optimization, but the returned set MUST be the issues that `issueMatchesGetIndicator` accepts.

#### Scenario: getInProgress returns issues carrying the in-progress convention label

- **Given** an open issue carrying `status:in-progress`
- **When** `fetchInProgress` runs
- **Then** the issue is returned, and `issueMatchesGetIndicator` accepted it against the in-progress convention-label indicator

### Requirement: The contract kit MUST assert the single-active-status invariant on both backends

The backend-neutral provider contract suite MUST exercise a full `todo → in-progress → review → done` lifecycle walk and, for the GitHub backend, assert that the issue carries at most one `status:*` label at every open step. The Linear backend MUST continue to pass the same lifecycle cases unchanged.

#### Scenario: Lifecycle walk keeps exactly one status label on GitHub

- **Given** a fresh GitHub contract backend with one seeded todo issue
- **When** the issue is driven `applyIndicator(inProgress)` then `applyIndicator(review)` then `applyIndicator(done)`
- **Then** at each open step the issue carries at most one label under the `status:` prefix
- **And** after `done` the issue is closed and surfaces in `fetchDoneCandidates`
