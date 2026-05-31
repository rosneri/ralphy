/**
 * Field catalogue for the customized setup walkthrough. Field ids are dotted
 * paths into the WORKFLOW.md frontmatter; the wizard stores answers keyed by id
 * and the builder writes each id straight to its path. `when` gates a field on a
 * prior answer so sub-options only appear when their section is enabled.
 *
 * `hint` is a short inline note about the input itself (e.g. "blank = all
 * teams"); `description` is a one-line explanation of what the setting does,
 * shown under the question. Migrations (see migrations.ts) reference these ids.
 */
import type { WizardValue } from "@ralphy/workflow/wizard";

export type FieldSpec =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; placeholder?: string }
  | { kind: "select"; options: { label: string; value: string }[] }
  | { kind: "multiselect"; options: { label: string; value: string }[] }
  | { kind: "list"; placeholder?: string }
  | { kind: "confirm"; defaultChoice: "confirm" | "cancel" }
  | { kind: "indicators" };

export interface Field {
  id: string;
  label: string;
  /** Short inline note about the input (rendered next to the label). */
  hint?: string;
  /** One-line explanation of the setting (rendered under the question). */
  description?: string;
  emptyLabel?: string;
  spec: FieldSpec;
  /** Only ask this field when the predicate holds against current answers. */
  when?: (answers: Record<string, WizardValue>) => boolean;
}

const yes = (): FieldSpec => ({ kind: "confirm", defaultChoice: "confirm" });
const no = (): FieldSpec => ({ kind: "confirm", defaultChoice: "cancel" });

const PROJECT_NAME: Field = {
  id: "project.name",
  label: "Project name",
  description: "Shown in prompts and logs to identify this project.",
  spec: { kind: "text", placeholder: "my-project" },
};
const LINEAR_TEAM: Field = {
  id: "linear.team",
  label: "Linear team key",
  hint: "e.g. ENG — leave blank to match all teams",
  description: "Restrict issue pickup to one Linear team. Blank watches every team.",
  emptyLabel: "all teams",
  spec: { kind: "text" },
};
const LINEAR_ASSIGNEE: Field = {
  id: "linear.assignee",
  label: "Linear assignee",
  hint: "user id, email, or 'me' — blank for unassigned",
  description: "Only pick up issues assigned to this person. Blank picks up unassigned issues.",
  emptyLabel: "unassigned",
  spec: { kind: "text" },
};

const QUICK_FIELDS: Field[] = [PROJECT_NAME, LINEAR_TEAM, LINEAR_ASSIGNEE];

const isOn =
  (id: string) =>
  (answers: Record<string, WizardValue>): boolean =>
    answers[id] === true;

const CUSTOMIZED_FIELDS: Field[] = [
  // ── Project ──
  PROJECT_NAME,
  {
    id: "project.language",
    label: "Language",
    description: "Primary language, included in the agent's project context.",
    spec: { kind: "text", placeholder: "TypeScript" },
  },
  {
    id: "project.framework",
    label: "Framework",
    description: "Primary framework/toolchain, included in the agent's project context.",
    spec: { kind: "text", placeholder: "Bun + Nx" },
  },

  // ── Commands ──
  {
    id: "commands.test",
    label: "Test command",
    description: "Command the agent runs to validate its work each iteration.",
    spec: { kind: "text", placeholder: "bun test" },
  },
  {
    id: "commands.lint",
    label: "Lint command",
    description: "Command the agent runs to lint before finishing a task.",
    spec: { kind: "text", placeholder: "bun run lint" },
  },
  {
    id: "commands.build",
    label: "Build command",
    description: "Command the agent runs to confirm the project still builds.",
    spec: { kind: "text", placeholder: "bun run build" },
  },
  {
    id: "commands.typecheck",
    label: "Typecheck command",
    description: "Command the agent runs to confirm types still pass.",
    spec: { kind: "text", placeholder: "bun run typecheck" },
  },

  // ── Engine ──
  {
    id: "engine",
    label: "Engine",
    description: "Which coding engine drives the loop.",
    spec: {
      kind: "select",
      options: [
        { label: "claude", value: "claude" },
        { label: "codex", value: "codex" },
      ],
    },
  },
  {
    id: "model",
    label: "Model tier",
    description: "Model tier the engine uses — higher tiers cost more per token.",
    spec: {
      kind: "select",
      options: [
        { label: "opus", value: "opus" },
        { label: "sonnet", value: "sonnet" },
        { label: "haiku", value: "haiku" },
      ],
    },
  },
  {
    id: "logRawStream",
    label: "Log the raw engine stream to stdout?",
    description: "Print the engine's raw event stream — verbose, useful for debugging.",
    spec: no(),
  },
  {
    id: "taskVerbose",
    label: "Pass --verbose to the task sub-process?",
    description: "Run each task sub-process in verbose mode for extra diagnostics.",
    spec: no(),
  },

  // ── Scheduling ──
  {
    id: "concurrency",
    label: "Concurrency (parallel tasks)",
    description: "How many tasks run in parallel. Higher uses more API quota at once.",
    spec: { kind: "number", placeholder: "1" },
  },
  {
    id: "pollIntervalSeconds",
    label: "Poll interval (seconds)",
    description: "How often agent mode checks Linear for new issues.",
    spec: { kind: "number", placeholder: "60" },
  },
  {
    id: "iterationDelaySeconds",
    label: "Delay between iterations (seconds)",
    description: "Throttle: pause this long between loop iterations.",
    spec: { kind: "number", placeholder: "0" },
  },

  // ── Per-task limits (0 = unlimited) ──
  {
    id: "maxIterationsPerTask",
    label: "Max iterations per task (0 = unlimited)",
    description: "Hard cap on loop iterations before a task is stopped.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxCostUsdPerTask",
    label: "Max cost USD per task (0 = unlimited)",
    description: "Stop a task once its accumulated API cost exceeds this many dollars.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxRuntimeMinutesPerTask",
    label: "Max runtime minutes per task (0 = unlimited)",
    description: "Stop a task after this much wall-clock time.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxConsecutiveFailuresPerTask",
    label: "Max consecutive identical failures",
    description: "Stop a task after this many identical failures in a row.",
    spec: { kind: "number", placeholder: "5" },
  },

  // ── Worktree & run flags ──
  {
    id: "useWorktree",
    label: "Run each task in an isolated git worktree?",
    description: "Isolate each task in its own worktree so parallel tasks don't collide.",
    spec: no(),
  },
  {
    id: "cleanupWorktreeOnSuccess",
    label: "Delete the worktree after a successful task?",
    description: "Remove the task's worktree once it succeeds to reclaim disk.",
    spec: no(),
    when: isOn("useWorktree"),
  },
  {
    id: "setupScript",
    label: "Setup script (runs before each task)",
    description: "Shell script run before each task (e.g. install deps).",
    spec: { kind: "text" },
  },
  {
    id: "teardownScript",
    label: "Teardown script (runs after each task)",
    description: "Shell script run after each task (e.g. cleanup).",
    spec: { kind: "text" },
  },
  {
    id: "enableManualTest",
    label: "Enable the manual-test phase?",
    description: "Add a phase that prompts for manual UI testing before finishing.",
    spec: no(),
  },
  {
    id: "appendPrompt",
    label: "Extra text appended to every prompt",
    description: "Free-text appended to every agent prompt (house rules, reminders).",
    spec: { kind: "text" },
  },

  // ── Pull requests ──
  {
    id: "createPrOnSuccess",
    label: "Open a pull request when a task succeeds?",
    description: "Open a PR automatically once a task completes successfully.",
    spec: no(),
  },
  {
    id: "prDraft",
    label: "Open pull requests as drafts?",
    description: "Open PRs in draft state instead of ready-for-review.",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "prBaseBranch",
    label: "PR base branch",
    description: "Branch new PRs target.",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "stackPrsOnDependencies",
    label: "Stack dependent issues' PRs onto their blocker's PR?",
    description: "Base a dependent issue's PR on its blocker's open PR instead of main.",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "autoMergeStrategy",
    label: "Auto-merge strategy",
    description: "How GitHub merges the PR when auto-merge fires.",
    spec: {
      kind: "select",
      options: [
        { label: "squash", value: "squash" },
        { label: "merge", value: "merge" },
        { label: "rebase", value: "rebase" },
      ],
    },
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "manualMergeWhenAutoMergeDisabled",
    label: "Merge manually when GitHub auto-merge is disabled?",
    description: "If the repo has auto-merge off, have Ralphy merge the PR itself.",
    spec: yes(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "finalizeNoOpAsDone",
    label: "Finalize a no-op (meta-only) change as done?",
    description: "When a change touched only meta files, mark it done instead of retrying.",
    spec: yes(),
  },

  // ── CI auto-fix ──
  {
    id: "fixCiOnFailure",
    label: "Let the agent fix CI failures?",
    description: "After opening a PR, let the agent watch CI and push fixes for failures.",
    spec: no(),
  },
  {
    id: "maxCiFixAttempts",
    label: "Max CI-fix attempts per task",
    description: "Give up fixing CI after this many attempts.",
    spec: { kind: "number", placeholder: "5" },
    when: isOn("fixCiOnFailure"),
  },
  {
    id: "ciPollIntervalSeconds",
    label: "CI status poll interval (seconds)",
    description: "How often to poll the PR's CI status while fixing.",
    spec: { kind: "number", placeholder: "30" },
    when: isOn("fixCiOnFailure"),
  },
  {
    id: "ignoreCiChecks",
    label: "CI checks to ignore",
    description: "Named checks that don't block merge (e.g. known-flaky jobs).",
    spec: { kind: "list", placeholder: "check name" },
  },

  // ── Rules & boundaries ──
  {
    id: "rules",
    label: "Project rules",
    description: "House rules injected into every prompt the agent receives.",
    spec: { kind: "list", placeholder: "a rule" },
  },
  {
    id: "boundaries.never_touch",
    label: "Never-touch globs",
    description: "Glob patterns the agent must never modify.",
    spec: { kind: "list", placeholder: "dist/**" },
  },

  // ── Linear team / comments / sync ──
  LINEAR_TEAM,
  LINEAR_ASSIGNEE,
  {
    id: "linear.postComments",
    label: "Post progress comments on the Linear issue?",
    description: "Post status comments on the issue as the task runs.",
    spec: yes(),
  },
  {
    id: "linear.updateEveryIterations",
    label: "Post a progress update every N iterations (0 = off)",
    description: "Cadence for progress comments, measured in loop iterations.",
    spec: { kind: "number", placeholder: "10" },
  },
  {
    id: "linear.mentionTrigger",
    label: "Watch comments/PRs for @mentions?",
    description: "Re-engage a done issue when someone @mentions the bot.",
    spec: yes(),
  },
  {
    id: "linear.mentionHandle",
    label: "Mention handle",
    description: "The handle that triggers re-engagement when mentioned.",
    spec: { kind: "text", placeholder: "@ralphy" },
    when: isOn("linear.mentionTrigger"),
  },
  {
    id: "linear.codeReviewTrigger",
    label: "Watch PRs for unresolved review threads?",
    description: "Re-engage when a tracked PR has unresolved review comments.",
    spec: yes(),
  },
  {
    id: "linear.codeReviewStaleHours",
    label: "Code-review stale window (hours)",
    description: "Ignore review threads older than this many hours.",
    spec: { kind: "number", placeholder: "24" },
    when: isOn("linear.codeReviewTrigger"),
  },
  {
    id: "linear.syncTasksToComment",
    label: "Mirror tasks.md into a sticky Linear comment?",
    description: "Keep a pinned comment in sync with the task checklist.",
    spec: yes(),
  },
  {
    id: "linear.syncSpecsAsAttachments",
    label: "Upload proposal.md / design.md as attachments?",
    description: "Attach the OpenSpec proposal and design docs to the issue.",
    spec: yes(),
    when: isOn("linear.syncTasksToComment"),
  },
  {
    id: "linear.specAttachmentFormats",
    label: "Spec attachment formats",
    description: "Which formats to upload: markdown, a rendered PDF, or both.",
    spec: {
      kind: "multiselect",
      options: [
        { label: "md", value: "md" },
        { label: "pdf", value: "pdf" },
      ],
    },
    when: isOn("linear.syncSpecsAsAttachments"),
  },

  // ── Confirmation mode ──
  {
    id: "linear.confirmationMode.enabled",
    label: "Enable the human confirmation gate?",
    description: "Pause after planning and wait for a human to approve before implementing.",
    spec: no(),
  },
  {
    id: "linear.confirmationMode.timeoutHours",
    label: "Confirmation timeout (hours)",
    description: "Auto-resolve the gate if nobody responds within this window.",
    spec: { kind: "number", placeholder: "48" },
    when: isOn("linear.confirmationMode.enabled"),
  },
  {
    id: "linear.confirmationMode.maxConfirmationRounds",
    label: "Max confirmation rounds",
    description: "How many revise-and-reconfirm rounds are allowed before giving up.",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("linear.confirmationMode.enabled"),
  },

  // ── Linear indicators ──
  {
    id: "linear.indicators",
    label: "Linear lifecycle indicators",
    description: "How lifecycle events map to Linear statuses/labels (pickup, done, error).",
    spec: { kind: "indicators" },
  },

  // ── Advanced gates ──
  {
    id: "preExistingErrorCheck.enabled",
    label: "Enable the base-branch health gate?",
    description: "Before picking up work, fail fast if the base branch is already broken.",
    spec: no(),
  },
  {
    id: "preExistingErrorCheck.commands",
    label: "Health-gate commands (blank = use lint/test)",
    description: "Commands run against the base branch to judge its health.",
    spec: { kind: "list", placeholder: "bun run lint" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.baseBranch",
    label: "Health-gate base branch",
    description: "Branch the health gate checks out and tests.",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.label",
    label: "Health-gate Linear label",
    description: "Label applied to issues opened when the base branch is unhealthy.",
    spec: { kind: "text", placeholder: "ralph:pre-existing-error" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "prTracker.enabled",
    label: "Enable the PR tracker?",
    description: "Watch open PRs and auto-recover ones whose merge state goes red.",
    spec: yes(),
  },
  {
    id: "prTracker.maxRecoveryAttempts",
    label: "PR tracker max recovery attempts",
    description: "Give up recovering a red PR after this many attempts.",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("prTracker.enabled"),
  },
  {
    id: "prTracker.advanceMergedToDone",
    label: "Advance merged PRs to done automatically?",
    description: "Move an issue to done as soon as its PR merges.",
    spec: no(),
    when: isOn("prTracker.enabled"),
  },
  {
    id: "metaPrompt.enabled",
    label: "Enable the meta-prompt addendum?",
    description: "Prepend a task-level meta-prompt layer to each phase.",
    spec: yes(),
  },
  {
    id: "openspec.reviewPhase.enabled",
    label: "Enable the OpenSpec review phase?",
    description: "After tasks finish, spawn a reviewer that reads the diff and files findings.",
    spec: no(),
  },
  {
    id: "openspec.reviewPhase.maxRounds",
    label: "Review phase max rounds",
    description: "How many review→fix cycles to run before archiving the change.",
    spec: { kind: "number", placeholder: "1" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerModel",
    label: "Reviewer model (blank = same as main)",
    description: "Model for the review pass — a cheaper tier saves cost.",
    spec: { kind: "text", placeholder: "haiku" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerContextStrategy",
    label: "Reviewer context",
    description: "'fresh' starts a new session; 'warm' resumes the last task session.",
    spec: {
      kind: "select",
      options: [
        { label: "fresh", value: "fresh" },
        { label: "warm", value: "warm" },
      ],
    },
    when: isOn("openspec.reviewPhase.enabled"),
  },
];

/**
 * The fields to ask for a mode, filtered by their `when` predicate. When
 * `restrictTo` is given (the migration diff path), only fields whose id is in
 * that set are asked — their `when` gates still apply, so enabling a parent
 * toggle reveals its (also-restricted) children.
 */
export function fieldsForMode(
  mode: SetupModeLike,
  answers: Record<string, WizardValue> = {},
  restrictTo?: string[],
): Field[] {
  const all = mode === "customized" ? CUSTOMIZED_FIELDS : QUICK_FIELDS;
  const allowed = restrictTo ? new Set(restrictTo) : null;
  return all.filter((field) => {
    if (allowed && !allowed.has(field.id)) return false;
    return !field.when || field.when(answers);
  });
}

type SetupModeLike = "quick" | "permissive" | "customized";
