/**
 * Canonical default `WORKFLOW.md` written by `ralph init` when no file exists.
 * Top-level keys are grouped into thematic sections (scheduling, limits,
 * engine, worktree, PRs, CI, base-branch gate, Linear). Indicator examples
 * sit under the state they belong to so get/set/clear read top-to-bottom.
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
  # Files that count as "meta only" for the pre-PR substantive-diff guard.
  # If every changed file matches one of these globs, the loop refuses to
  # open the PR and respawns the worker — the actual implementation was
  # lost (either deleted mid-loop or absorbed by a merge from base).
  meta_only_files:
    - "openspec/**"
    - ".ralph/**"
    - "**/agent-tasks.md"
    - "**/tasks.md"
    - "**/MANUAL_TESTING*.md"

# ─── Scheduling ──────────────────────────────────────────────
# How many tasks to run in parallel.
concurrency: 1
# Seconds between polls for new Linear issues (agent mode).
pollIntervalSeconds: 60
# Seconds to wait between loop iterations (throttle).
iterationDelaySeconds: 0

# ─── Per-task limits (0 = unlimited) ─────────────────────────
maxIterationsPerTask: 0
maxCostUsdPerTask: 0
maxRuntimeMinutesPerTask: 0
# Stop a task after this many consecutive identical failures.
maxConsecutiveFailuresPerTask: 5

# ─── Engine ──────────────────────────────────────────────────
# Underlying engine: "claude" or "codex".
engine: claude
# Model tier: "haiku", "sonnet", or "opus".
model: opus
# Log the raw engine stream to stdout.
logRawStream: false
# Pass --verbose to the ralph task sub-process.
taskVerbose: false

# ─── Worktree ────────────────────────────────────────────────
# Run each task in an isolated git worktree.
useWorktree: false
# Delete the worktree after a successful task.
cleanupWorktreeOnSuccess: false

# ─── Pull requests ───────────────────────────────────────────
# Open a pull request after a task succeeds.
createPrOnSuccess: false
# Base branch for pull requests.
prBaseBranch: main
# When true, stack dependent issues' PRs onto their blocker's open PR.
stackPrsOnDependencies: false
# Strategy used when GitHub auto-merge is enabled.
autoMergeStrategy: squash

# ─── CI auto-fix ─────────────────────────────────────────────
# Let the agent attempt to fix CI failures after a PR is created.
fixCiOnFailure: false
# Maximum number of CI-fix attempts per task.
maxCiFixAttempts: 5
# Seconds between CI status polls.
ciPollIntervalSeconds: 30

# ─── Base-branch health gate ─────────────────────────────────
# Pre-existing error check: gate the agent when the base branch is already
# broken. When enabled, the agent runs these commands against the base
# branch HEAD before scheduling new work; failures open a Linear ticket
# and pause new pickups.
preExistingErrorCheck:
  enabled: false
  # Commands to run against the base branch. When empty, falls back to commands.lint / commands.test.
  commands: []
  baseBranch: main
  label: "ralph:pre-existing-error"
  outputCharLimit: 4000

# ─── Linear integration ──────────────────────────────────────
linear:
  # Linear team key (e.g. "ENG"). Omit to match all teams.
  # team: ENG

  # Post progress comments on the Linear issue while a task is running.
  postComments: true
  # Post a progress update every N iterations. 0 disables.
  updateEveryIterations: 10

  # Watch done-issue comments + linked GitHub PR comments for @ralphy mentions.
  mentionTrigger: true
  mentionHandle: "@ralphy"

  # Watch open tracked PRs for unresolved review-thread comments.
  codeReviewTrigger: true
  codeReviewStaleHours: 24

  # Mirror the loop's tasks.md into a sticky Linear comment (always the
  # last comment on the issue). Updates on worker launch, on the same
  # cadence as updateEveryIterations, and on done-transition.
  syncTasksToComment: true

  # Upload openspec proposal.md and design.md as Linear attachments on the
  # parent issue. Refreshed when file contents change, no-op otherwise.
  # Requires syncTasksToComment.
  syncSpecsAsAttachments: true

  # Which rendered formats to upload alongside each spec. "md" mirrors
  # the source file as-is. Add "pdf" to also upload a pdfkit-rendered
  # PDF as a peer attachment (handy when viewing Linear on mobile).
  specAttachmentFormats: ["md"]

  # Confirmation mode — opt-in human gate between the OpenSpec \`tasks\`
  # and \`implement\` phases. When \`enabled: true\`, after the agent
  # finishes drafting tasks it posts a one-shot "📋 Ralphy plan ready"
  # comment and parks the ticket in \`awaiting-confirmation\` until a
  # human reacts:
  #   • Approve  → apply the \`getApproved\` label (Ralphy then strips
  #                it via \`clearApproved\` and moves on to implement).
  #   • Revise   → leave a \`@ralphy revise: <reason>\` comment. Ralphy
  #                writes the reason into steering, bumps the round
  #                counter, and loops back to \`design\`.
  #   • Skip     → label the ticket with \`optOutLabel\` (default
  #                \`ralph:auto-approve\`) to bypass the gate entirely.
  # confirmationMode:
  #   enabled: true
  #   optOutLabel: "ralph:auto-approve"
  #   timeoutHours: 48
  #   maxConfirmationRounds: 3

  # Indicators map Ralph lifecycle events to Linear labels/statuses.
  #
  # Filter semantics (per indicator's \`filter:\` list):
  #   • Entries of the SAME type (e.g. two \`status\` entries) are ORed
  #     — the issue matches if any value matches.
  #   • Entries of DIFFERENT types (one \`status\` + one \`label\`) are
  #     ANDed — the issue must satisfy every type.
  #   Example: a filter with two statuses + one label matches issues
  #   where status ∈ {A, B} AND label = L.
  #
  # Sections below group one state at a time; its get/set/clear sit
  # adjacent so the lifecycle reads top-to-bottom.
  indicators:
    # ── Todo (pickup trigger) ────────────
    # getTodo:
    #   filter:
    #     - type: status
    #       value: Todo
    #
    # ── In Progress ──────────────────────
    # getInProgress:
    #   filter:
    #     - type: status
    #       value: In Progress
    # setInProgress:
    #   type: status
    #   value: In Progress
    #
    # ── Done → Review hand-off ───────────
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
    # ── Conflicted ───────────────────────
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
    # ── Confirmation gate (opt-in) ───────
    # Pairs with linear.confirmationMode above. The agent parks gated
    # tickets in \`awaiting-confirmation\` until \`getApproved\` matches,
    # then strips the marker via \`clearApproved\` and proceeds.
    # getApproved:
    #   filter:
    #     - type: label
    #       value: "ralph:approved"
    # clearApproved:
    #   type: label
    #   value: "ralph:approved"
    # # Optional: surface the parked state on the ticket itself. Applied
    # # once on gate-entry; removed on every release path.
    # setAwaitingConfirmation:
    #   type: label
    #   value: "ralph:awaiting-confirmation"
    # clearAwaitingConfirmation:
    #   type: label
    #   value: "ralph:awaiting-confirmation"
    #
    # ── Auto-merge (opt-in) ──────────────
    # getAutoMerge:
    #   filter:
    #     - type: label
    #       value: "ralph:auto-merge"
    #
    # ── Error quarantine ─────────────────
    # setError:
    #   type: label
    #   value: "ralph:error"
    #
    # # Project-based filter / assignment
    # # getTodo can filter by Linear project name, and setInProgress can
    # # reassign the issue into a different project.
    # getTodo:
    #   filter:
    #     - type: project
    #       value: "Ralph Queue"
    # setInProgress:
    #   type: project
    #   value: "Ralph In Progress"
---
You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

{{ issue.description }}

{% if issue.labels %}
Labels: {{ issue.labels | join(", ") }}
{% endif %}

{% if rules %}
Project rules:
{% for rule in rules %}- {{ rule }}
{% endfor %}
{% endif %}

{% if boundaries.never_touch %}
Never modify: {{ boundaries.never_touch | join(", ") }}.
{% endif %}
`;
