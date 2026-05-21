# agent-conflict-promotion — RLF-82 deltas

## ADDED Requirements

### Requirement: Conflict-fix worker fix-task MUST instruct the worker to push

The conflict-fix fix-task body MUST include an explicit push step. Specifically, the body prepended by `apps/agent/src/agent/wire/prepare.ts` for a `conflict-fix` trigger MUST direct the worker to push the resolved branch back to `origin/<branch>` and to inspect any rejection (force-with-lease broken, pre-push hook failure, ref-update policy rejection) inline before either retrying or stopping and surfacing the reason.

#### Scenario: prepended body lists the push step

- **Given** the coordinator selects an issue for a `conflict-fix` trigger
- **When** `prepareTaskForTrigger("conflict-fix", changeName)` runs
- **Then** the prepended `## ` section in `tasks.md` contains a step that
  tells the worker to push the resolved branch to `origin/<branch>` and
  to react to push rejections in-context (rather than relying on the
  post-task harness to retry).

### Requirement: post-task MUST NOT push for conflict-fix mode

The post-task harness MUST NOT push for a `conflict-fix` iteration. When `runPostTask` is invoked with a `conflict-fix` mode signal, it MUST NOT invoke `git push` (directly or via `createPrWithRetry`, `pushWithLeases`, or `fixConflictsAndCiLoop`'s `wantConflictLoop` branch), and it MUST NOT prepend a fix-task to recover from a push rejection in this mode.

#### Scenario: harness does not push during conflict-fix verification

- **Given** the worker exited 0 after a conflict-fix iteration
- **When** `runPostTask({ mode: "conflict-fix", ... })` runs
- **Then** no `git push` invocation is issued by the harness
- **And** no fix-task is prepended to `tasks.md` by the harness in
  response to a push rejection.

### Requirement: post-task MUST verify mergeability via a single fetchPrStatus call

For a `conflict-fix` iteration whose worker exited 0, the harness MUST
call `fetchPrStatus(prUrl, cmd, cwd)` (from
`apps/agent/src/pr-status.ts`) exactly once and dispatch as follows:

1. `kind === "ok"` and `mergeable === "MERGEABLE"` → apply
   `clearConflicted` (existing indicator) to the Linear issue and
   return `0`.
2. `kind === "ok"` and `mergeable === "CONFLICTING"` → emit a yellow
   log line of the form `! <identifier>: still CONFLICTING after
rebase; will retry` and return `0`. The `ralph:conflict` label
   (or whatever `setConflicted` applies) MUST remain in place so the
   next poll re-queues the ticket.
3. `kind === "ok"` and `mergeable === "UNKNOWN"`, or `kind ===
"error"` → emit a yellow warning and return `0` without mutating
   any label.

#### Scenario: MERGEABLE clears the conflicted indicator

- **Given** a conflict-fix iteration whose worker exited 0
- **And** `fetchPrStatus` resolves to `{ kind: "ok", mergeable: "MERGEABLE", ... }`
- **When** the conflict-fix branch of `runPostTask` runs
- **Then** `clearConflicted` is invoked exactly once for the issue
- **And** `runPostTask` returns `0`.

#### Scenario: CONFLICTING leaves the label in place

- **Given** a conflict-fix iteration whose worker exited 0
- **And** `fetchPrStatus` resolves to `{ kind: "ok", mergeable: "CONFLICTING", ... }`
- **When** the conflict-fix branch of `runPostTask` runs
- **Then** `clearConflicted` is NOT invoked
- **And** a yellow log line containing `still CONFLICTING after rebase` is emitted
- **And** `runPostTask` returns `0`.

#### Scenario: UNKNOWN / error is non-destructive

- **Given** a conflict-fix iteration whose worker exited 0
- **And** `fetchPrStatus` resolves to `{ kind: "error", message: "<any>" }`
  (or `{ kind: "ok", mergeable: "UNKNOWN", ... }`)
- **When** the conflict-fix branch of `runPostTask` runs
- **Then** no label mutation occurs and no `git push` is issued
- **And** a yellow warning is logged
- **And** `runPostTask` returns `0`.

### Requirement: non-conflict modes MUST retain the existing push + hook-fix retry path

Non-conflict modes MUST retain the existing push + hook-fix retry path. For triggers `fresh`, `resume`, and `review` (i.e. `mode !== "conflict-fix"`), `runPostTask` MUST continue to invoke the legacy push + hook-fix retry harness (`createPrWithRetry`, `pushWithLeases`, `fixConflictsAndCiLoop`) exactly as before this change. No behaviour change is permitted for those modes.

#### Scenario: fresh-mode iteration still pushes and retries

- **Given** a `fresh` iteration whose worker exited 0
- **When** `runPostTask({ mode: "fresh", ... })` runs
- **Then** the harness invokes `createPullRequest`/`createPrWithRetry`
  as it did before this change
- **And** push rejections still trigger the hook-fix retry loop with
  the same `cfg.maxCiFixAttempts` budget.
