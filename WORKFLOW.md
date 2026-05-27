---
project:
  name: ralphy
  language: TypeScript
  framework: Bun + Nx

commands:
  test: bun test
  lint: bun run lint
  build: bun run build:publish
  typecheck: bun run typecheck

rules:
  - "use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync"
  - "never reduce coverage threshold"
  - "strive to write code in packages and only consume it from apps"

boundaries:
  never_touch:
    - "dist/**"
    - ".claude/worktrees/**"
  # Globs that mark a file as "meta only". Before opening a PR, the loop runs
  # `git diff --name-only origin/<base>...HEAD`; if every file matches one of
  # these, the PR is blocked (the substantive change has been lost) and a fix
  # task is prepended to agent-tasks.md so the next iteration restores the
  # implementation. Defaults shown below — extend with repo-specific paths.
  meta_only_files:
    - "openspec/**"
    - ".ralph/**"
    - "**/agent-tasks.md"
    - "**/tasks.md"
    - "**/MANUAL_TESTING*.md"

# How many tasks to run in parallel.
concurrency: 1

# Stop picking up new issues after N have been started this run. 0 = unlimited.
maxTickets: 0

# Strategy used when getAutoMerge matches: "squash" | "merge" | "rebase".
autoMergeStrategy: squash

# Seconds between polls for new Linear issues (agent mode).
pollIntervalSeconds: 60

# Maximum iterations per task. 0 = unlimited.
maxIterationsPerTask: 300

# Maximum cost in USD per task. 0 = unlimited.
maxCostUsdPerTask: 0

# Maximum wall-clock minutes per task. 0 = unlimited.
maxRuntimeMinutesPerTask: 0

# Stop a task after this many consecutive identical failures.
maxConsecutiveFailuresPerTask: 5

# Seconds to wait between loop iterations (throttle).
iterationDelaySeconds: 0

# Log the raw engine stream to stdout.
logRawStream: true

# Pass --verbose to the ralph task sub-process.
taskVerbose: false

# Enable manual testing phase for each task (forwarded as --manual-test).
enableManualTest: true

# Run each task in an isolated git worktree.
useWorktree: true

# Delete the worktree after a successful task.
cleanupWorktreeOnSuccess: false

# Shell script to run inside the worktree before the task starts.
setupScript: bun install

# Open a pull request after a task succeeds.
createPrOnSuccess: true

# Base branch for pull requests.
prBaseBranch: main

# Let the agent attempt to fix CI failures after a PR is created.
fixCiOnFailure: true

# Maximum number of CI-fix attempts per task.
maxCiFixAttempts: 10

# Stack dependent issues' PRs onto the open PR of their blocker.
stackPrsOnDependencies: true

# Seconds between CI status polls.
ciPollIntervalSeconds: 60

# RLF-173: scheduler-tier watcher for In-Review PRs whose merge state goes
# red (CONFLICTING or CI-failed). When enabled, each scheduler tick rolls
# the existing gh-driven merge-state scan through a persistent attempt
# counter stored at `.ralph/pr-tracker-state.json` (keyed by Linear issue
# identifier). Each detected failure increments the counter and demotes
# the issue back to In Progress so the conflict-fix / ci-fix worker picks
# it up. Once the counter exceeds `maxRecoveryAttempts`, ralphy stops
# auto-demoting that issue, applies the `ralph:error` (`setError`) label,
# and posts a Linear comment explaining why — preventing a stubbornly
# broken PR from bouncing forever. The counter resets when the PR returns
# to a mergeable state, or when a human clears `ralph:error` and removes
# the state file entry. Pass `--no-pr-tracker` to disable for a single
# run without editing WORKFLOW.md.
prTracker:
  enabled: true
  maxRecoveryAttempts: 3
  advanceMergedToDone: false

# Underlying engine: "claude" or "codex".
engine: claude

# Model tier: "haiku", "sonnet", or "opus".
model: sonnet

linear:
  team: RLF

  postComments: true
  updateEveryIterations: 10

  mentionTrigger: true
  mentionHandle: "@ralphy-read"

  codeReviewTrigger: true
  codeReviewStaleHours: 24

  # Mirror the loop's tasks.md into a sticky Linear comment that always
  # lands at the bottom of the issue timeline.
  syncTasksToComment: true

  # Upload openspec proposal.md and design.md as Linear attachments on
  # the parent issue. Refreshed when file contents change, no-op
  # otherwise. Requires syncTasksToComment.
  syncSpecsAsAttachments: true

  # Which rendered formats to upload for each spec. "md" mirrors the
  # source file as-is. "pdf" also uploads a pdfkit-rendered PDF mirror
  # as a peer attachment (handy when viewing Linear on mobile).
  specAttachmentFormats: ["pdf"]

  # Confirmation mode — human gate between the OpenSpec `tasks` and
  # `implement` phases. Approve via `getApproved`, revise via
  # `@ralphy revise: <reason>`.
  # optInLabel: only gate tickets that carry this label (opt-in mode).
  # optOutLabel: skip the gate for tickets that carry this label.
  confirmationMode:
    enabled: true
    optInLabel: "confirm"
    optOutLabel: "auto-approve"
    timeoutHours: 48
    maxConfirmationRounds: 3

  # Indicators grouped by lifecycle: each get* is followed by the set*/clear*
  # that mutates the same status/label, so a reader sees the whole lifecycle
  # in one block.
  indicators:
    # Todo → In Progress
    getTodo:
      filter:
        - type: status
          value: Todo
    getInProgress:
      filter:
        - type: status
          value: In Progress
    setInProgress:
      type: status
      value: In Progress

    # Done / review hand-off
    setDone:
      type: status
      value: In Review
    getReview:
      filter:
        - type: label
          value: "review"
    clearReview:
      type: label
      value: "review"

    # Merge-state lifecycle (conflicted / ci-failed / mergeable) is
    # driven by GitHub directly via `gh pr view` — no Linear indicators
    # to configure here.

    # Auto-merge opt-in
    getAutoMerge:
      filter:
        - type: label
          value: "auto-merge"

    # Confirmation gate (paired with linear.confirmationMode above)
    getApproved:
      filter:
        - type: label
          value: "approved"
    clearApproved:
      type: label
      value: "approved"

    # Error quarantine
    setError:
      type: label
      value: "error"
---

You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

{% if issue.labels %}
Labels: {{ issue.labels | join(", ") }}
{% endif %}

{% for label in issue.labels %}{% if label == "deploy" %}
When you finish the implementation, run `/ship-feature` to release it — the `deploy` label opted this issue into the ship pipeline.
{% endif %}{% endfor %}

{% if rules %}
Project rules:
{% for rule in rules %}- {{ rule }}
{% endfor %}
{% endif %}

{% if boundaries.never_touch %}
Never modify: {{ boundaries.never_touch | join(", ") }}.
{% endif %}
