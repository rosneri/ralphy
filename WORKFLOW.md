---
project:
  # The project's display name. Ralphy puts it in the agent's prompt and in
  # its logs.
  name: ralphy
  # Primary programming language (e.g. TypeScript). Added to the agent's
  # prompt as context.
  language: TypeScript
  # Primary framework or toolchain (e.g. Bun + Nx). Added to the agent's
  # prompt as context.
  framework: Bun, NX

commands:
  # Shell command Ralphy runs to check the agent's work each iteration; its
  # exit code decides pass or fail.
  test: bun test
  # Shell command Ralphy runs to lint the code before a task is allowed to
  # finish.
  lint: bun run lint
  # Shell command Ralphy runs to confirm the project still compiles / builds.
  build: bun run build:publish
  # Shell command Ralphy runs to confirm the project's types still pass.
  typecheck: bun run typecheck

# House rules added to every prompt (e.g. 'never edit generated files'). One
# rule per entry.
rules:
  - use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
  - never reduce coverage threshold
  - strive to write code in packages and only consume it from apps

boundaries:
  # Glob patterns for files the agent must never modify (e.g. dist/**).
  never_touch:
    - dist/**
    - .claude/worktrees/**
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

# How many tasks Ralphy works on at once. Higher finishes faster but uses
# more API quota simultaneously.
concurrency: 2

# Stop picking up new issues after N have been started this run. 0 = unlimited.
maxTickets: 0

# How GitHub combines the PR's commits when it auto-merges: squash (one
# commit), merge (a merge commit), or rebase.
autoMergeStrategy: merge

# In agent mode, how often (in seconds) Ralphy checks Linear for new issues
# to pick up.
pollIntervalSeconds: 60

# Stop a task after this many loop iterations. 0 means no limit (run until
# done or another limit hits).
maxIterationsPerTask: 300

# Stop a task once its API spend passes this many US dollars. 0 means no
# cost limit.
maxCostUsdPerTask: 0

# Stop a task after this many minutes of wall-clock time. 0 means no time
# limit.
maxRuntimeMinutesPerTask: 0

# Give up on a task after this many identical failures in a row — a guard
# against stuck loops.
maxConsecutiveFailuresPerTask: 5

# Seconds to pause between loop iterations — a throttle to slow spend. 0
# means no pause.
iterationDelaySeconds: 0

# Print the engine's raw event stream to the terminal. Very verbose — mainly
# for debugging.
logRawStream: true

# Run the per-task process with --verbose for extra diagnostic output.
taskVerbose: true

# Add a phase that pauses for a human to manually test the change (e.g. in
# the UI) before the task is marked done.
enableManualTest: true

# Run each task in its own git worktree (a separate working copy of the
# repo) so parallel tasks don't overwrite each other's files.
useWorktree: true

# Delete a task's worktree (its separate working copy) once it succeeds, to
# reclaim disk space.
cleanupWorktreeOnSuccess: false

# Shell script run once before each task starts — e.g. to install
# dependencies.
setupScript: bun i

# When a task succeeds, automatically push the branch and open a GitHub pull
# request (PR).
createPrOnSuccess: true

# The branch new pull requests merge into (their base) — e.g. main.
prBaseBranch: main

# After opening a PR, watch its CI (the automated checks GitHub runs) and
# let the agent push fixes when they fail.
fixCiOnFailure: true

# Stop trying to fix failing CI after this many attempts.
maxCiFixAttempts: 10

# If an issue is blocked by another that already has an open PR, base this
# issue's PR on that PR's branch instead of main (a 'stacked' PR).
stackPrsOnDependencies: true

# How often (in seconds) to re-check the PR's CI status while waiting on or
# fixing it.
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
  # Keep watching the PRs Ralphy opened and automatically try to recover any
  # whose merge state goes red (conflicts or failing CI).
  enabled: true
  # Give up auto-recovering a red PR after this many attempts, then flag it
  # for a human.
  maxRecoveryAttempts: 3
  # Move an issue to its done state as soon as its PR is merged.
  advanceMergedToDone: true

# Which AI coding tool runs the loop: 'claude' (Claude Code) or 'codex'
# (OpenAI Codex).
engine: claude

# Model tier the engine uses. 'opus' is the most capable, 'haiku' the
# cheapest and fastest; higher tiers cost more per token.
model: opus

linear:
  # Only pick up issues from this Linear team, given by its key (e.g. ENG).
  # Leave blank to watch every team.
  team: RLF

  # Post progress comments on the Linear issue while a task runs.
  postComments: true
  # Post a progress comment every N loop iterations. 0 turns periodic updates
  # off.
  updateEveryIterations: 10

  # Watch a finished issue's comments and its PR for @mentions of Ralphy, and
  # re-engage when mentioned.
  mentionTrigger: true
  # The @handle that, when mentioned, makes Ralphy pick the issue back up
  # (e.g. @ralphy).
  mentionHandle: "@ralphy-read"

  # Watch open PRs for unresolved review comments and re-engage to address
  # them.
  codeReviewTrigger: true
  # Ignore review comments older than this many hours, so stale threads don't
  # re-trigger work.
  codeReviewStaleHours: 48

  # Keep one pinned ('sticky') Linear comment in sync with the task checklist
  # (tasks.md).
  syncTasksToComment: false

  # Upload the OpenSpec planning docs (proposal.md, design.md) to the issue as
  # attachments. OpenSpec is Ralphy's spec-driven planning format.
  syncSpecsAsAttachments: true

  # Which formats to upload the spec docs in: 'md' (raw markdown), 'pdf' (a
  # rendered PDF), or both.
  specAttachmentFormats:
    - pdf

  # Confirmation mode — human gate between the OpenSpec `tasks` and
  # `implement` phases. Approve via the `getApproved` indicator (apply the
  # `approved` label), revise via `@ralphy revise: <reason>`. Add an optional
  # `getAutoApprove` indicator to let matching issues skip the gate.
  confirmationMode:
    # Pause after the agent finishes planning and wait for a human to approve
    # before it writes any code (a confirmation gate).
    enabled: true
    # If no one approves or rejects within this many hours, auto-resolve the
    # confirmation gate.
    timeoutHours: 48
    # How many times the plan can be revised and re-submitted for approval
    # before Ralphy gives up.
    maxConfirmationRounds: 3

  # How Ralphy maps lifecycle events to Linear statuses/labels — which issues
  # to pick up (todo) and what to set when a task is in progress, done, or
  # errored.
  indicators:
    getTodo:
      filter:
        - type: status
          value: Todo
    getInProgress:
      filter:
        - type: status
          value: In Progress
    getApproved:
      filter:
        - type: label
          value: approved
          group: Ralphy
    setInProgress:
      type: status
      value: In Progress
    setDone:
      type: status
      value: In Review
    setError:
      type: label
      value: error
      group: Ralphy
prDraft: true
manualMergeWhenAutoMergeDisabled: true
finalizeNoOpAsDone: true
preExistingErrorCheck:
  # Before picking up new work, run health-check commands on the base branch
  # and pause if it's already broken, so the agent isn't blamed for
  # pre-existing failures.
  enabled: false
metaPrompt:
  # Add Ralphy's task-level 'meta-prompt' layer (extra framing instructions)
  # to each phase. Leave on unless you want raw prompts.
  enabled: true
  # How much effort the meta-prompt nudges the agent toward per ticket. 'auto'
  # detects it from the ticket; 'light'/'standard'/'heavy' pin every ticket to
  # that tier.
  effort: auto
openspec:
  reviewPhase:
    # After all tasks finish, spawn a separate reviewer agent that reads the
    # full diff and writes review findings; open findings loop back into more
    # work.
    enabled: true
    maxRounds: 2
    reviewerModel: opus
    reviewerContextStrategy: fresh
version: 1
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
