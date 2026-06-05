/**
 * Canonical default `WORKFLOW.md` skeleton. This holds only the settings and
 * their values — the explanatory comment above each one is stamped in from the
 * field catalogue's descriptions at build time (see wizard.ts), so the inline
 * docs have a single source. Comments here are limited to keys that have no
 * catalogue field (the schema `version`, `meta_only_files`) plus the indicator
 * examples block, which `ralphy init`'s indicator builder complements.
 */
/** Matches a YAML frontmatter block: `[1]` is the YAML, `[2]` is the body. */
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const DEFAULT_WORKFLOW_MD = `---
# WORKFLOW.md schema version — managed by \`ralphy init\`. When a newer version
# ships, re-running init migrates this file and fills in the new settings.
version: 2

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

concurrency: 1
pollIntervalSeconds: 60
iterationDelaySeconds: 0

maxIterationsPerTask: 0
maxCostUsdPerTask: 0
maxRuntimeMinutesPerTask: 0
maxConsecutiveFailuresPerTask: 5

engine: claude
model: opus
logRawStream: true
taskVerbose: false

useWorktree: false
cleanupWorktreeOnSuccess: false

createPrOnSuccess: false
prDraft: true
prBaseBranch: main
stackPrsOnDependencies: false
autoMergeStrategy: squash

fixCiOnFailure: false
maxCiFixAttempts: 5
ciPollIntervalSeconds: 30

preExistingErrorCheck:
  enabled: false
  commands: []
  baseBranch: main
  label: "ralph:pre-existing-error"
  outputCharLimit: 4000

linear:
  filter: assignee = me
  postComments: true
  updateEveryIterations: 10
  mentionTrigger: true
  mentionHandle: "@ralphy"
  codeReviewTrigger: true
  codeReviewStaleHours: 24
  syncTasksToComment: true
  syncSpecsAsAttachments: true
  specAttachmentFormats: ["md"]
  # replace (default): overwrite the canonical design attachment in place; append: keep each sealed change as a new "#N" attachment
  specAttachmentRevisions: replace
  indicators:
    # Indicators map Ralph lifecycle events to Linear labels/statuses. Within an
    # indicator's \`filter:\` list, entries of the SAME type are ORed and entries
    # of DIFFERENT types are ANDed. \`ralphy init\` can build these for you; the
    # blocks below are copy-paste examples (uncomment and edit to use).
    #
    # getTodo:           # which issues to pick up
    #   filter:
    #     - type: status
    #       value: Todo
    # setInProgress:     # status/label to set when work starts
    #   type: status
    #   value: In Progress
    # setDone:           # status/label to set when the PR is opened
    #   type: status
    #   value: In Review
    # setPrReady:        # additive: marker set when the PR is ready for human review
    #   type: status     # (fires unless the PR is auto-merged immediately; does not replace setDone)
    #   value: In Review
    # setError:          # label applied when a task is quarantined
    #   type: label
    #   value: "ralph:error"
    # getAutoMerge:      # opt-in: only auto-merge issues that match
    #   filter:
    #     - type: label
    #       value: "ralph:auto-merge"

openspec:
  reviewPhase:
    enabled: true
---
You are working on {{ issue.identifier }}: {{ issue.title }}.

{% if attempt > 1 %}
Previous attempt failed with: {{ last_error }}
{% endif %}

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
