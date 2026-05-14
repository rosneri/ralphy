/**
 * Canonical default `WORKFLOW.md` written by `ralph init` when no file exists.
 * Indicator block uses grouped-by-lifecycle layout: each `get…` sits beside
 * the `set…`/`clear…` that mutates the same status/label, under a comment
 * header naming the lifecycle.
 */
export const DEFAULT_WORKFLOW_MD = `---
project:
  name: ralphy
  language: TypeScript
  framework: Bun + Nx

commands:
  test: bun test
  lint: bun run lint
  build: bun run build
  typecheck: bun run typecheck

rules: []

boundaries:
  never_touch:
    - "dist/**"
    - ".claude/worktrees/**"

# How many tasks to run in parallel.
concurrency: 1

# Seconds between polls for new Linear issues (agent mode).
pollIntervalSeconds: 60

# Maximum iterations per task. 0 = unlimited.
maxIterationsPerTask: 0

# Maximum cost in USD per task. 0 = unlimited.
maxCostUsdPerTask: 0

# Maximum wall-clock minutes per task. 0 = unlimited.
maxRuntimeMinutesPerTask: 0

# Stop a task after this many consecutive identical failures.
maxConsecutiveFailuresPerTask: 5

# Seconds to wait between loop iterations (throttle).
iterationDelaySeconds: 0

# Log the raw engine stream to stdout.
logRawStream: false

# Pass --verbose to the ralph task sub-process.
taskVerbose: false

# Run each task in an isolated git worktree.
useWorktree: false

# Delete the worktree after a successful task.
cleanupWorktreeOnSuccess: false

# Open a pull request after a task succeeds.
createPrOnSuccess: false

# Base branch for pull requests.
prBaseBranch: main

# When true, stack dependent issues' PRs onto their blocker's open PR.
stackPrsOnDependencies: false

# Strategy used when GitHub auto-merge is enabled.
autoMergeStrategy: squash

# Let the agent attempt to fix CI failures after a PR is created.
fixCiOnFailure: false

# Maximum number of CI-fix attempts per task.
maxCiFixAttempts: 5

# Seconds between CI status polls.
ciPollIntervalSeconds: 30

# Underlying engine: "claude" or "codex".
engine: claude

# Model tier: "haiku", "sonnet", or "opus".
model: opus

linear:
  # Linear team key (e.g. "ENG"). Omit to match all teams.
  # team: ENG

  # Post progress comments on the Linear issue while a task is running.
  postComments: true

  # Post a progress update every N iterations. 0 disables.
  updateEveryIterations: 10

  # Watch done-issue comments + linked GitHub PR comments for @ralphy mentions.
  mentionTrigger: false
  mentionHandle: "@ralphy"

  # Watch open tracked PRs for unresolved review-thread comments.
  codeReviewTrigger: false
  codeReviewStaleHours: 24

  # Indicators map Ralph lifecycle events to Linear labels/statuses.
  # Grouped by lifecycle: each get* is followed by the set*/clear* that
  # mutates the same state, so the lifecycle reads top-to-bottom.
  indicators: {}
    # Todo -> In Progress
    # getTodo:
    #   filter:
    #     - type: status
    #       value: Todo
    # getInProgress:
    #   filter:
    #     - type: status
    #       value: In Progress
    # setInProgress:
    #   type: status
    #   value: In Progress
    #
    # # Done / review hand-off
    # setDone:
    #   type: status
    #   value: In Review
    # getReview:
    #   filter:
    #     - type: label
    #       value: "ralph:review"
    # clearReview:
    #   type: label
    #   value: "ralph:review"
    #
    # # Conflict lifecycle
    # getConflicted:
    #   filter:
    #     - type: label
    #       value: "ralph:conflict"
    # setConflicted:
    #   type: label
    #   value: "ralph:conflict"
    # clearConflicted:
    #   type: label
    #   value: "ralph:conflict"
    #
    # # Auto-merge opt-in
    # getAutoMerge:
    #   filter:
    #     - type: label
    #       value: "ralph:auto-merge"
    #
    # # Error quarantine
    # setError:
    #   type: label
    #   value: "ralph:error"
---
You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

{{ issue.description }}

{% if rules %}
Project rules:
{% for rule in rules %}- {{ rule }}
{% endfor %}
{% endif %}

{% if boundaries.never_touch %}
Never modify: {{ boundaries.never_touch | join(", ") }}.
{% endif %}
`;
