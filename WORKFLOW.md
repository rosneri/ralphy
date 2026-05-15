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

# How many tasks to run in parallel.
concurrency: 2

# Stop picking up new issues after N have been started this run. 0 = unlimited.
maxTickets: 0

# Strategy used when getAutoMerge matches: "squash" | "merge" | "rebase".
autoMergeStrategy: squash

# Seconds between polls for new Linear issues (agent mode).
pollIntervalSeconds: 60

# Maximum iterations per task. 0 = unlimited.
maxIterationsPerTask: 100

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

# Underlying engine: "claude" or "codex".
engine: claude

# Model tier: "haiku", "sonnet", or "opus".
model: opus

linear:
  team: RLF

  postComments: true
  updateEveryIterations: 10

  mentionTrigger: true
  mentionHandle: "@ralphy"

  codeReviewTrigger: true
  codeReviewStaleHours: 24

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
          value: "ralph:review"
    clearReview:
      type: label
      value: "ralph:review"

    # Conflict lifecycle
    getConflicted:
      filter:
        - type: label
          value: "ralph:conflict"
    setConflicted:
      type: label
      value: "ralph:conflict"
    clearConflicted:
      type: label
      value: "ralph:conflict"

    # Auto-merge opt-in
    getAutoMerge:
      filter:
        - type: label
          value: "ralph:auto-merge"

    # Error quarantine
    setError:
      type: label
      value: "ralph:error"
---

You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

{{ issue.description }}

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
