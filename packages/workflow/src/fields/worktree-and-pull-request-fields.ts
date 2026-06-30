import type { Field } from "../fields";
import { no, selectFromSchema, yes } from "./field-spec-builders";
import { concurrencyForcesWorktree, isOn, worktreeEnabled } from "./field-conditions";

/**
 * Customized-walkthrough fields covering worktree handling, run flags, pull
 * request creation, PR recovery, and project rules / boundaries.
 */
export const WORKTREE_AND_PULL_REQUEST_FIELDS: Field[] = [
  // ── Worktree & run flags ──
  {
    id: "useWorktree",
    label: "Run each task in an isolated git worktree?",
    description:
      "Run each task in its own git worktree (a separate working copy of the repo) so parallel tasks don't overwrite each other's files. Forced on when concurrency is greater than 1.",
    spec: no(),
    // Hidden once concurrency > 1 forces worktrees on — it is no longer optional.
    when: (answers) => !concurrencyForcesWorktree(answers),
  },
  {
    id: "cleanupWorktreeOnSuccess",
    label: "Delete the worktree after a successful task?",
    description:
      "Delete a task's worktree (its separate working copy) once it succeeds, to reclaim disk space.",
    spec: no(),
    when: worktreeEnabled,
  },
  {
    id: "setupScript",
    label: "Worktree setup script (runs once per worktree)",
    description:
      "Part of the worktree flow: a shell script run once when a task's worktree is first created — e.g. to install dependencies in the new working copy. It does NOT re-run on resume, conflict-fix, ci-fix, or review re-runs that reuse an existing worktree.",
    spec: { kind: "text" },
    when: worktreeEnabled,
  },
  {
    id: "teardownScript",
    label: "Worktree teardown script (runs after each task)",
    description:
      "Part of the worktree flow: a shell script run once in each task's worktree after the task ends — e.g. to clean up before the worktree is removed.",
    spec: { kind: "text" },
    when: worktreeEnabled,
  },
  {
    id: "enableManualTest",
    label: "Enable the manual-test phase?",
    description:
      "Add a phase that pauses for a human to manually test the change (e.g. in the UI) before the task is marked done.",
    spec: no(),
  },
  {
    id: "appendPrompt",
    label: "Extra text appended to every prompt",
    description:
      "Free text added to the end of every prompt sent to the agent — house rules or reminders.",
    spec: { kind: "text" },
  },

  // ── Pull requests ──
  {
    id: "createPrOnSuccess",
    label: "Open a pull request when a task succeeds?",
    description:
      "When a task succeeds, automatically push the branch and open a GitHub pull request (PR).",
    spec: no(),
  },
  {
    id: "prDraft",
    label: "Open pull requests as drafts?",
    description: "Open PRs as drafts (marked not-ready-for-review) instead of ready for review.",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "prBaseBranch",
    label: "PR base branch",
    description: "The branch new pull requests merge into (their base) — e.g. main.",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "prLabels",
    label: "PR labels",
    description:
      "GitHub labels attached to every pull request Ralph opens. The labels must already exist in the repo; a missing one is skipped, never fatal. One label per entry.",
    spec: { kind: "list", placeholder: "ralph" },
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "stackPrsOnDependencies",
    label: "Stack dependent issues' PRs onto their blocker's PR?",
    description:
      "If an issue is blocked by another that already has an open PR, base this issue's PR on that PR's branch instead of main (a 'stacked' PR).",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "autoMergeStrategy",
    label: "Auto-merge strategy",
    description:
      "How GitHub combines the PR's commits when it auto-merges: squash (one commit), merge (a merge commit), or rebase.",
    spec: selectFromSchema("autoMergeStrategy"),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "manualMergeWhenAutoMergeDisabled",
    label: "Merge manually when GitHub auto-merge is disabled?",
    description:
      "If the repo doesn't have GitHub's auto-merge feature enabled, have Ralphy merge the PR itself once checks pass.",
    spec: yes(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "finalizeNoOpAsDone",
    label: "Finalize a no-op (meta-only) change as done?",
    description:
      "If a change ended up touching only meta files (specs, task lists) and no real code, mark the issue done instead of retrying it.",
    spec: yes(),
  },

  // ── PR recovery ──
  {
    id: "prRecovery.enabled",
    label: "Enable PR recovery (conflicts + CI)?",
    description:
      "After a worker opens a PR, keep watching it: advance the ticket to done once the PR is mergeable (CI green, no conflicts), and auto-recover red PRs by re-running the agent — resolving merge conflicts AND fixing failing CI checks. Turn off to mark the ticket done immediately on PR open and do no watching anywhere. (Fine-grained `fixCi` / `fixConflicts` toggles live in WORKFLOW.md, both on by default.)",
    spec: yes(),
  },
  {
    id: "prRecovery.maxRecoverySessions",
    label: "Max PR recovery sessions",
    description:
      "Give up auto-recovering a red PR after this many recovery sessions, then flag it for a human.",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("prRecovery.enabled"),
  },
  {
    id: "prRecovery.ignoreChecks",
    label: "CI checks to ignore",
    description:
      "Names of CI checks to ignore when deciding whether a PR is green — e.g. known-flaky jobs.",
    spec: { kind: "list", placeholder: "check name" },
    when: isOn("prRecovery.enabled"),
  },

  // ── Rules & boundaries ──
  {
    id: "rules",
    label: "Project rules",
    description:
      "House rules added to every prompt (e.g. 'never edit generated files'). One rule per entry.",
    spec: { kind: "list", placeholder: "a rule" },
  },
  {
    id: "boundaries.never_touch",
    label: "Never-touch globs",
    description: "Glob patterns for files the agent must never modify (e.g. dist/**).",
    spec: { kind: "list", placeholder: "dist/**" },
  },
];
