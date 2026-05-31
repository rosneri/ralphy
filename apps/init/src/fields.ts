/**
 * Field catalogue for the customized setup walkthrough. Field ids are dotted
 * paths into the WORKFLOW.md frontmatter; the wizard stores answers keyed by id
 * and the builder writes each id straight to its path. `when` gates a field on a
 * prior answer so sub-options only appear when their section is enabled.
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
  hint?: string;
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
  spec: { kind: "text", placeholder: "my-project" },
};
const LINEAR_TEAM: Field = {
  id: "linear.team",
  label: "Linear team key",
  hint: "e.g. ENG — leave blank to match all teams",
  emptyLabel: "all teams",
  spec: { kind: "text" },
};
const LINEAR_ASSIGNEE: Field = {
  id: "linear.assignee",
  label: "Linear assignee",
  hint: "user id, email, or 'me' — blank for unassigned",
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
  { id: "project.language", label: "Language", spec: { kind: "text", placeholder: "TypeScript" } },
  { id: "project.framework", label: "Framework", spec: { kind: "text", placeholder: "Bun + Nx" } },

  // ── Commands ──
  { id: "commands.test", label: "Test command", spec: { kind: "text", placeholder: "bun test" } },
  {
    id: "commands.lint",
    label: "Lint command",
    spec: { kind: "text", placeholder: "bun run lint" },
  },
  {
    id: "commands.build",
    label: "Build command",
    spec: { kind: "text", placeholder: "bun run build" },
  },
  {
    id: "commands.typecheck",
    label: "Typecheck command",
    spec: { kind: "text", placeholder: "bun run typecheck" },
  },

  // ── Engine ──
  {
    id: "engine",
    label: "Engine",
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
    spec: {
      kind: "select",
      options: [
        { label: "opus", value: "opus" },
        { label: "sonnet", value: "sonnet" },
        { label: "haiku", value: "haiku" },
      ],
    },
  },
  { id: "logRawStream", label: "Log the raw engine stream to stdout?", spec: no() },
  { id: "taskVerbose", label: "Pass --verbose to the task sub-process?", spec: no() },

  // ── Scheduling ──
  {
    id: "concurrency",
    label: "Concurrency (parallel tasks)",
    spec: { kind: "number", placeholder: "1" },
  },
  {
    id: "pollIntervalSeconds",
    label: "Poll interval (seconds)",
    spec: { kind: "number", placeholder: "60" },
  },
  {
    id: "iterationDelaySeconds",
    label: "Delay between iterations (seconds)",
    spec: { kind: "number", placeholder: "0" },
  },

  // ── Per-task limits (0 = unlimited) ──
  {
    id: "maxIterationsPerTask",
    label: "Max iterations per task (0 = unlimited)",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxCostUsdPerTask",
    label: "Max cost USD per task (0 = unlimited)",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxRuntimeMinutesPerTask",
    label: "Max runtime minutes per task (0 = unlimited)",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxConsecutiveFailuresPerTask",
    label: "Max consecutive identical failures",
    spec: { kind: "number", placeholder: "5" },
  },

  // ── Worktree & run flags ──
  { id: "useWorktree", label: "Run each task in an isolated git worktree?", spec: no() },
  {
    id: "cleanupWorktreeOnSuccess",
    label: "Delete the worktree after a successful task?",
    spec: no(),
    when: isOn("useWorktree"),
  },
  { id: "setupScript", label: "Setup script (runs before each task)", spec: { kind: "text" } },
  { id: "teardownScript", label: "Teardown script (runs after each task)", spec: { kind: "text" } },
  { id: "enableManualTest", label: "Enable the manual-test phase?", spec: no() },
  { id: "appendPrompt", label: "Extra text appended to every prompt", spec: { kind: "text" } },

  // ── Pull requests ──
  { id: "createPrOnSuccess", label: "Open a pull request when a task succeeds?", spec: no() },
  {
    id: "prDraft",
    label: "Open pull requests as drafts?",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "prBaseBranch",
    label: "PR base branch",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "stackPrsOnDependencies",
    label: "Stack dependent issues' PRs onto their blocker's PR?",
    spec: no(),
    when: isOn("createPrOnSuccess"),
  },
  {
    id: "autoMergeStrategy",
    label: "Auto-merge strategy",
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
    spec: yes(),
    when: isOn("createPrOnSuccess"),
  },
  { id: "finalizeNoOpAsDone", label: "Finalize a no-op (meta-only) change as done?", spec: yes() },

  // ── CI auto-fix ──
  { id: "fixCiOnFailure", label: "Let the agent fix CI failures?", spec: no() },
  {
    id: "maxCiFixAttempts",
    label: "Max CI-fix attempts per task",
    spec: { kind: "number", placeholder: "5" },
    when: isOn("fixCiOnFailure"),
  },
  {
    id: "ciPollIntervalSeconds",
    label: "CI status poll interval (seconds)",
    spec: { kind: "number", placeholder: "30" },
    when: isOn("fixCiOnFailure"),
  },
  {
    id: "ignoreCiChecks",
    label: "CI checks to ignore",
    spec: { kind: "list", placeholder: "check name" },
  },

  // ── Rules & boundaries ──
  { id: "rules", label: "Project rules", spec: { kind: "list", placeholder: "a rule" } },
  {
    id: "boundaries.never_touch",
    label: "Never-touch globs",
    spec: { kind: "list", placeholder: "dist/**" },
  },

  // ── Linear team / comments / sync ──
  LINEAR_TEAM,
  LINEAR_ASSIGNEE,
  { id: "linear.postComments", label: "Post progress comments on the Linear issue?", spec: yes() },
  {
    id: "linear.updateEveryIterations",
    label: "Post a progress update every N iterations (0 = off)",
    spec: { kind: "number", placeholder: "10" },
  },
  { id: "linear.mentionTrigger", label: "Watch comments/PRs for @mentions?", spec: yes() },
  {
    id: "linear.mentionHandle",
    label: "Mention handle",
    spec: { kind: "text", placeholder: "@ralphy" },
    when: isOn("linear.mentionTrigger"),
  },
  {
    id: "linear.codeReviewTrigger",
    label: "Watch PRs for unresolved review threads?",
    spec: yes(),
  },
  {
    id: "linear.codeReviewStaleHours",
    label: "Code-review stale window (hours)",
    spec: { kind: "number", placeholder: "24" },
    when: isOn("linear.codeReviewTrigger"),
  },
  {
    id: "linear.syncTasksToComment",
    label: "Mirror tasks.md into a sticky Linear comment?",
    spec: yes(),
  },
  {
    id: "linear.syncSpecsAsAttachments",
    label: "Upload proposal.md / design.md as attachments?",
    spec: yes(),
    when: isOn("linear.syncTasksToComment"),
  },
  {
    id: "linear.specAttachmentFormats",
    label: "Spec attachment formats",
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
    spec: no(),
  },
  {
    id: "linear.confirmationMode.timeoutHours",
    label: "Confirmation timeout (hours)",
    spec: { kind: "number", placeholder: "48" },
    when: isOn("linear.confirmationMode.enabled"),
  },
  {
    id: "linear.confirmationMode.maxConfirmationRounds",
    label: "Max confirmation rounds",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("linear.confirmationMode.enabled"),
  },

  // ── Linear indicators ──
  { id: "linear.indicators", label: "Linear lifecycle indicators", spec: { kind: "indicators" } },

  // ── Advanced gates ──
  { id: "preExistingErrorCheck.enabled", label: "Enable the base-branch health gate?", spec: no() },
  {
    id: "preExistingErrorCheck.commands",
    label: "Health-gate commands (blank = use lint/test)",
    spec: { kind: "list", placeholder: "bun run lint" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.baseBranch",
    label: "Health-gate base branch",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.label",
    label: "Health-gate Linear label",
    spec: { kind: "text", placeholder: "ralph:pre-existing-error" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  { id: "prTracker.enabled", label: "Enable the PR tracker?", spec: yes() },
  {
    id: "prTracker.maxRecoveryAttempts",
    label: "PR tracker max recovery attempts",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("prTracker.enabled"),
  },
  {
    id: "prTracker.advanceMergedToDone",
    label: "Advance merged PRs to done automatically?",
    spec: no(),
    when: isOn("prTracker.enabled"),
  },
  { id: "metaPrompt.enabled", label: "Enable the meta-prompt addendum?", spec: yes() },
  { id: "openspec.reviewPhase.enabled", label: "Enable the OpenSpec review phase?", spec: no() },
  {
    id: "openspec.reviewPhase.maxRounds",
    label: "Review phase max rounds",
    spec: { kind: "number", placeholder: "1" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerModel",
    label: "Reviewer model (blank = same as main)",
    spec: { kind: "text", placeholder: "haiku" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerContextStrategy",
    label: "Reviewer context",
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

/** The fields to ask for a mode, filtered by their `when` predicate. */
export function fieldsForMode(
  mode: SetupModeLike,
  answers: Record<string, WizardValue> = {},
): Field[] {
  const all = mode === "customized" ? CUSTOMIZED_FIELDS : QUICK_FIELDS;
  return all.filter((field) => !field.when || field.when(answers));
}

type SetupModeLike = "quick" | "permissive" | "customized";
