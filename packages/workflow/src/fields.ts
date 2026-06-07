/**
 * Field catalogue for the customized setup walkthrough. Field ids are dotted
 * paths into the WORKFLOW.md frontmatter; the wizard stores answers keyed by id
 * and the builder writes each id straight to its path. `when` gates a field on a
 * prior answer so sub-options only appear when their section is enabled.
 *
 * `hint` is a short inline note about the input itself (e.g. "blank = all
 * teams"); `description` is a one- or two-sentence explanation of what the
 * setting does, written for someone new to Ralphy — it is shown under the
 * question AND pasted as a comment above the setting in the generated
 * WORKFLOW.md (a test keeps the two in sync). Migrations reference these ids.
 */
import type { WizardValue } from "./wizard-types";

export type FieldSpec =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; placeholder?: string }
  | { kind: "select"; options: { label: string; value: string }[] }
  | { kind: "multiselect"; options: { label: string; value: string }[] }
  | { kind: "list"; placeholder?: string }
  | { kind: "confirm"; defaultChoice: "confirm" | "cancel" }
  | { kind: "indicators" }
  | { kind: "multiline" };

/** Reserved field id whose value is the prompt body, not a frontmatter setting. */
export const PROMPT_BODY_FIELD_ID = "promptBody";

/**
 * Control field id: a confirm that decides whether the detected `repo` block is
 * written. Its own value is never persisted — the builder strips it and uses it
 * to gate the `repo.*` answers (see `buildFromAnswers`).
 */
export const REPO_LINK_FIELD_ID = "repo.link";

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
  description: "The project's display name. Ralphy puts it in the agent's prompt and in its logs.",
  spec: { kind: "text", placeholder: "my-project" },
};
const LINEAR_TEAM: Field = {
  id: "linear.team",
  label: "Linear team key",
  hint: "e.g. ENG — leave blank to match all teams",
  description:
    "The Linear team this repository is linked to, given by its key (e.g. ENG). Ralphy only picks up issues from this team. Leave blank to watch every team.",
  emptyLabel: "all teams",
  spec: { kind: "text" },
};
/**
 * Shown only when `ralphy init` detected the current git repo (its `repo.name`
 * is injected as an initial value). Confirming records the detected repo in
 * WORKFLOW.md and links it to the Linear team; declining omits the `repo` block.
 * `repo.link` is a control answer — it is never written to the file (see
 * `buildFromAnswers`), so it carries a description without a real frontmatter key.
 */
const REPO_LINK: Field = {
  id: "repo.link",
  label: "Record this repository in WORKFLOW.md?",
  description:
    "Record the detected git repository in WORKFLOW.md so Ralphy maps this project's Linear issues to it. Confirm to adopt the detected repo; decline to leave it out.",
  spec: yes(),
  when: (answers) => typeof answers["repo.name"] === "string" && answers["repo.name"] !== "",
};
/**
 * Control field ids: how to filter Linear tickets by assignee. The select value
 * (`me` / `any` / `unassigned` / `other`) and the optional specific-user value
 * are combined by the builder into the single `linear.filter` expression — the
 * choice/value ids are never written as frontmatter keys (see `buildFromAnswers`).
 */
export const LINEAR_ASSIGNEE_CHOICE_FIELD_ID = "linear.assigneeChoice";
export const LINEAR_ASSIGNEE_VALUE_FIELD_ID = "linear.assigneeValue";

/** Comment stamped above `linear.filter` in a generated WORKFLOW.md. */
const LINEAR_FILTER_DESCRIPTION =
  "Global filter ANDed into every Linear ticket fetch: a marker list of 'assignee' and " +
  "'label' clauses (all required). assignee value is 'me' (assigned to you), 'any' " +
  "(regardless of assignee), 'unassigned', or a specific Linear user (email or user-id). " +
  "Add 'label' clauses to require the ticket carry those labels. Defaults to assignee = me.";

const LINEAR_ASSIGNEE_CHOICE: Field = {
  id: LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  label: "Linear assignee filter",
  description:
    "Which Linear issues Ralphy fetches, by assignee: 'me' (assigned to you), 'any' (regardless of assignee), 'unassigned', or a specific user you name next.",
  spec: {
    kind: "select",
    options: [
      { label: "me (assigned to you)", value: "me" },
      { label: "any (regardless of assignee)", value: "any" },
      { label: "unassigned", value: "unassigned" },
      { label: "a specific user (email or user-id)…", value: "other" },
    ],
  },
};

const LINEAR_ASSIGNEE_VALUE: Field = {
  id: LINEAR_ASSIGNEE_VALUE_FIELD_ID,
  label: "Assignee email or user-id",
  description: "The specific Linear user to filter by — their email address or Linear user-id.",
  spec: { kind: "text", placeholder: "you@example.com" },
  when: (answers) => answers[LINEAR_ASSIGNEE_CHOICE_FIELD_ID] === "other",
};

const QUICK_FIELDS: Field[] = [
  PROJECT_NAME,
  LINEAR_TEAM,
  REPO_LINK,
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
];

const isOn =
  (id: string) =>
  (answers: Record<string, WizardValue>): boolean =>
    answers[id] === true;

/**
 * Concurrency > 1 forces isolated git worktrees on — parallel tasks each need
 * their own working copy or they clobber each other's files. The wizard hides
 * the worktree toggle once concurrency > 1 (it is no longer optional) and the
 * builder writes `useWorktree: true`; the runtime enforces the same invariant.
 */
const concurrencyForcesWorktree = (answers: Record<string, WizardValue>): boolean => {
  const value = answers["concurrency"];
  return typeof value === "number" && value > 1;
};

/** Worktrees are effectively enabled when chosen OR forced by concurrency. */
const worktreeEnabled = (answers: Record<string, WizardValue>): boolean =>
  answers["useWorktree"] === true || concurrencyForcesWorktree(answers);

/**
 * Catalogue field ids that are kept (for CLI flags, frontmatter comments, and
 * migrations) but never asked in the setup walkthrough — their schema default
 * is taken instead. Filtered out of every mode by `fieldsForMode`.
 */
const HIDDEN_FIELD_IDS = new Set<string>([
  "appendPrompt",
  "metaPrompt.enabled",
  "metaPrompt.effort",
  "logRawStream",
  "maxConsecutiveFailuresPerTask",
  "prDraft",
  "manualMergeWhenAutoMergeDisabled",
  "finalizeNoOpAsDone",
  "linear.confirmationMode.maxConfirmationRounds",
  "openspec.reviewPhase.enabled",
]);

const CUSTOMIZED_FIELDS: Field[] = [
  // ── Project ──
  PROJECT_NAME,
  {
    id: "project.language",
    label: "Language",
    description:
      "Primary programming language (e.g. TypeScript). Added to the agent's prompt as context.",
    spec: { kind: "text", placeholder: "TypeScript" },
  },
  {
    id: "project.framework",
    label: "Framework",
    description:
      "Primary framework or toolchain (e.g. Bun + Nx). Added to the agent's prompt as context.",
    spec: { kind: "text", placeholder: "Bun + Nx" },
  },

  // ── Commands ──
  {
    id: "commands.test",
    label: "Test command",
    description:
      "Shell command Ralphy runs to check the agent's work each iteration; its exit code decides pass or fail.",
    spec: { kind: "text", placeholder: "bun test" },
  },
  {
    id: "commands.lint",
    label: "Lint command",
    description: "Shell command Ralphy runs to lint the code before a task is allowed to finish.",
    spec: { kind: "text", placeholder: "bun run lint" },
  },
  {
    id: "commands.build",
    label: "Build command",
    description: "Shell command Ralphy runs to confirm the project still compiles / builds.",
    spec: { kind: "text", placeholder: "bun run build" },
  },
  {
    id: "commands.typecheck",
    label: "Typecheck command",
    description: "Shell command Ralphy runs to confirm the project's types still pass.",
    spec: { kind: "text", placeholder: "bun run typecheck" },
  },

  // ── Engine ──
  {
    id: "engine",
    label: "Engine",
    description:
      "Which AI coding tool runs the loop: 'claude' (Claude Code) or 'codex' (OpenAI Codex).",
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
    description:
      "Model tier the engine uses. 'opus' is the most capable, 'haiku' the cheapest and fastest; higher tiers cost more per token.",
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
    description:
      "Print the engine's raw event stream to the terminal. Very verbose — mainly for debugging.",
    spec: no(),
  },
  {
    id: "taskVerbose",
    label: "Show detailed task output?",
    description:
      "Show detailed per-task output (passes --verbose to the task sub-process) for extra diagnostics.",
    spec: no(),
  },

  // ── Scheduling ──
  {
    id: "concurrency",
    label: "Concurrency (parallel tasks)",
    description:
      "How many tasks Ralphy works on at once. Higher finishes faster but uses more API quota simultaneously.",
    spec: { kind: "number", placeholder: "1" },
  },
  {
    id: "pollIntervalSeconds",
    label: "Poll interval (seconds)",
    description:
      "In agent mode, how often (in seconds) Ralphy checks Linear for new issues to pick up.",
    spec: { kind: "number", placeholder: "60" },
  },
  {
    id: "iterationDelaySeconds",
    label: "Delay between iterations (seconds)",
    description:
      "Seconds to pause between loop iterations — a throttle to slow spend. 0 means no pause.",
    spec: { kind: "number", placeholder: "0" },
  },

  // ── Per-task limits (0 = unlimited) ──
  {
    id: "maxIterationsPerTask",
    label: "Max iterations per task (0 = unlimited)",
    description:
      "Stop a task after this many loop iterations. 0 means no limit (run until done or another limit hits).",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxCostUsdPerTask",
    label: "Max cost USD per task (0 = unlimited)",
    description:
      "Stop a task once its API spend passes this many US dollars. 0 means no cost limit.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxRuntimeMinutesPerTask",
    label: "Max runtime minutes per task (0 = unlimited)",
    description: "Stop a task after this many minutes of wall-clock time. 0 means no time limit.",
    spec: { kind: "number", placeholder: "0" },
  },
  {
    id: "maxConsecutiveFailuresPerTask",
    label: "Max consecutive identical failures",
    description:
      "Give up on a task after this many identical failures in a row — a guard against stuck loops.",
    spec: { kind: "number", placeholder: "5" },
  },

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
    label: "Worktree setup script (runs before each task)",
    description:
      "Part of the worktree flow: a shell script run once in each task's fresh worktree before the task starts — e.g. to install dependencies in the new working copy.",
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

  // ── Linear team / comments / sync ──
  LINEAR_TEAM,
  REPO_LINK,
  LINEAR_ASSIGNEE_CHOICE,
  LINEAR_ASSIGNEE_VALUE,
  {
    id: "linear.postComments",
    label: "Post progress comments on the Linear issue?",
    description: "Post progress comments on the Linear issue while a task runs.",
    spec: yes(),
  },
  {
    id: "linear.updateEveryIterations",
    label: "Post a progress update every N iterations (0 = off)",
    description: "Post a progress comment every N loop iterations. 0 turns periodic updates off.",
    spec: { kind: "number", placeholder: "10" },
  },
  {
    id: "linear.mentionTrigger",
    label: "Watch comments/PRs for @mentions?",
    description:
      "Watch a finished issue's comments and its PR for @mentions of Ralphy, and re-engage when mentioned.",
    spec: yes(),
  },
  {
    id: "linear.mentionHandle",
    label: "Mention handle",
    description:
      "The @handle that, when mentioned, makes Ralphy pick the issue back up (e.g. @ralphy).",
    spec: { kind: "text", placeholder: "@ralphy" },
    when: isOn("linear.mentionTrigger"),
  },
  {
    id: "linear.codeReviewTrigger",
    label: "Watch PRs for unresolved review threads?",
    description: "Watch open PRs for unresolved review comments and re-engage to address them.",
    spec: yes(),
  },
  {
    id: "linear.codeReviewStaleHours",
    label: "Code-review stale window (hours)",
    description:
      "Ignore review comments older than this many hours, so stale threads don't re-trigger work.",
    spec: { kind: "number", placeholder: "24" },
    when: isOn("linear.codeReviewTrigger"),
  },
  {
    id: "linear.syncTasksToComment",
    label: "Sync tasks into a sticky Linear comment?",
    description:
      "Keep one pinned ('sticky') Linear comment in sync with the task checklist (tasks.md).",
    spec: yes(),
  },
  {
    id: "linear.syncSpecsAsAttachments",
    label: "Upload plan as attachments to the Linear ticket?",
    description:
      "Upload the OpenSpec planning docs (proposal.md, design.md) to the issue as attachments. OpenSpec is Ralphy's spec-driven planning format.",
    spec: yes(),
  },
  {
    id: "linear.specAttachmentFormats",
    label: "Plan attachment formats",
    description:
      "Which formats to upload the spec docs in: 'md' (raw markdown), 'pdf' (a rendered PDF), or both.",
    spec: {
      kind: "multiselect",
      options: [
        { label: "md", value: "md" },
        { label: "pdf", value: "pdf" },
      ],
    },
    when: isOn("linear.syncSpecsAsAttachments"),
  },
  // `linear.specAttachmentRevisions` is deliberately NOT a wizard field —
  // it is a config-file-only knob (defaults to "replace"); see schema.ts.

  // ── Confirmation mode ──
  {
    id: "linear.confirmationMode.enabled",
    label: "Enable the human confirmation gate?",
    description:
      "Pause after the agent finishes planning and wait for a human to approve before it writes any code (a confirmation gate).",
    spec: no(),
  },
  {
    id: "linear.confirmationMode.timeoutHours",
    label: "Confirmation timeout (hours)",
    description:
      "If no one approves or rejects within this many hours, auto-resolve the confirmation gate.",
    spec: { kind: "number", placeholder: "48" },
    when: isOn("linear.confirmationMode.enabled"),
  },
  {
    id: "linear.confirmationMode.maxConfirmationRounds",
    label: "Max confirmation rounds",
    description:
      "How many times the plan can be revised and re-submitted for approval before Ralphy gives up.",
    spec: { kind: "number", placeholder: "3" },
    when: isOn("linear.confirmationMode.enabled"),
  },

  // ── Linear indicators ──
  {
    id: "linear.indicators",
    label: "Linear lifecycle indicators",
    description:
      "How Ralphy maps lifecycle events to Linear statuses/labels — which issues to pick up (todo) and what to set when a task is in progress, done, or errored.",
    spec: { kind: "indicators" },
  },

  // ── Advanced gates ──
  {
    id: "preExistingErrorCheck.enabled",
    label: "Enable the base-branch health gate?",
    description:
      "Before picking up new work, run health-check commands on the base branch and pause if it's already broken, so the agent isn't blamed for pre-existing failures.",
    spec: no(),
  },
  {
    id: "preExistingErrorCheck.commands",
    label: "Health-gate commands (blank = use lint/test)",
    description:
      "Commands run against the base branch to judge its health. Leave empty to reuse your lint/test commands.",
    spec: { kind: "list", placeholder: "bun run lint" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.baseBranch",
    label: "Health-gate base branch",
    description: "The branch the health gate checks out and tests (usually main).",
    spec: { kind: "text", placeholder: "main" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "preExistingErrorCheck.label",
    label: "Health-gate Linear label",
    description:
      "Linear label applied to the ticket Ralphy opens when the base branch is found broken.",
    spec: { kind: "text", placeholder: "ralph:pre-existing-error" },
    when: isOn("preExistingErrorCheck.enabled"),
  },
  {
    id: "metaPrompt.enabled",
    label: "Enable the meta-prompt addendum?",
    description:
      "Add Ralphy's task-level 'meta-prompt' layer (extra framing instructions) to each phase. Leave on unless you want raw prompts.",
    spec: yes(),
  },
  {
    id: "metaPrompt.effort",
    label: "Per-ticket effort tier",
    description:
      "How much effort the meta-prompt nudges the agent toward per ticket. 'auto' detects it from the ticket; 'light'/'standard'/'heavy' pin every ticket to that tier.",
    spec: {
      kind: "select",
      options: [
        { label: "auto", value: "auto" },
        { label: "light", value: "light" },
        { label: "standard", value: "standard" },
        { label: "heavy", value: "heavy" },
      ],
    },
    when: isOn("metaPrompt.enabled"),
  },
  {
    id: "openspec.reviewPhase.enabled",
    label: "Enable the OpenSpec review phase?",
    description:
      "After all tasks finish, spawn a separate reviewer agent that reads the full diff and writes review findings; open findings loop back into more work.",
    spec: no(),
  },
  {
    id: "openspec.reviewPhase.maxRounds",
    label: "Review phase max rounds",
    description: "How many review→fix cycles to run before the change is archived regardless.",
    spec: { kind: "number", placeholder: "1" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerModel",
    label: "Reviewer model (blank = same as main)",
    description:
      "Model used for the review pass. Blank reuses the main model; a cheaper tier (e.g. haiku) saves cost.",
    spec: { kind: "text", placeholder: "haiku" },
    when: isOn("openspec.reviewPhase.enabled"),
  },
  {
    id: "openspec.reviewPhase.reviewerContextStrategy",
    label: "Reviewer context",
    description:
      "'fresh' gives the reviewer a brand-new session (unbiased); 'warm' resumes the last task's session (more context, cheaper).",
    spec: {
      kind: "select",
      options: [
        { label: "fresh", value: "fresh" },
        { label: "warm", value: "warm" },
      ],
    },
    when: isOn("openspec.reviewPhase.enabled"),
  },

  // ── Prompt body (the template sent to the agent) ──
  {
    id: PROMPT_BODY_FIELD_ID,
    label: "Customize the prompt sent to the agent?",
    description:
      "The prompt the agent receives lives in the file body — a template filled with per-issue values (e.g. {{ issue.identifier }}). Edit it here, or leave it and finish to keep the default.",
    spec: { kind: "multiline" },
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
    if (HIDDEN_FIELD_IDS.has(field.id)) return false;
    if (allowed && !allowed.has(field.id)) return false;
    return !field.when || field.when(answers);
  });
}

type SetupModeLike = "quick" | "permissive" | "customized";

/** Look up a catalogue field by its id (dotted config path). */
export function findField(id: string): Field | undefined {
  // Quick fields are a subset of the customized catalogue, so this covers both.
  return CUSTOMIZED_FIELDS.find((field) => field.id === id);
}

/** How a CLI flag's following token is parsed (or that it is a bare boolean). */
export type CliValueKind = "int" | "float" | "model" | "boolean";

/**
 * A CLI flag that writes a WORKFLOW.md setting. `fieldId` points at a real
 * catalogue field so the wizard and the CLI share one definition; `argKey` is
 * the property set on the parsed args object — its name intentionally differs
 * from the config path (e.g. `--max-iterations` → field `maxIterationsPerTask`
 * → `args.maxIterations`). Engine selection, `--unlimited`, and the non-config
 * flags (`--name`, `--prompt`, …) stay bespoke in the parser.
 */
export interface CliOption {
  fieldId: string;
  flag: string;
  argKey: string;
  kind: CliValueKind;
}

export const COMMON_CLI_OPTIONS: CliOption[] = [
  { fieldId: "model", flag: "--model", argKey: "model", kind: "model" },
  { fieldId: "iterationDelaySeconds", flag: "--delay", argKey: "delay", kind: "int" },
  { fieldId: "maxCostUsdPerTask", flag: "--max-cost", argKey: "maxCostUsd", kind: "float" },
  {
    fieldId: "maxRuntimeMinutesPerTask",
    flag: "--max-runtime",
    argKey: "maxRuntimeMinutes",
    kind: "float",
  },
  {
    fieldId: "maxConsecutiveFailuresPerTask",
    flag: "--max-failures",
    argKey: "maxConsecutiveFailures",
    kind: "int",
  },
  {
    fieldId: "maxIterationsPerTask",
    flag: "--max-iterations",
    argKey: "maxIterations",
    kind: "int",
  },
  { fieldId: "logRawStream", flag: "--log", argKey: "log", kind: "boolean" },
  { fieldId: "taskVerbose", flag: "--verbose", argKey: "verbose", kind: "boolean" },
];

/** Valid model values, sourced from the catalogue's `model` select field. */
export function modelOptionValues(): string[] {
  const field = findField("model");
  return field && field.spec.kind === "select" ? field.spec.options.map((o) => o.value) : [];
}

/**
 * Field descriptions keyed by frontmatter path — the single source for the
 * comment pasted above each setting in a generated WORKFLOW.md. The builder
 * stamps these onto live keys, so the wizard's on-screen help and the file's
 * inline docs never drift.
 */
export const FIELD_DESCRIPTIONS: { path: string[]; description: string }[] = [
  ...CUSTOMIZED_FIELDS.filter(
    (field): field is Field & { description: string } =>
      Boolean(field.description) && field.spec.kind !== "multiline",
  ).map((field) => ({ path: field.id.split("."), description: field.description })),
  // `linear.filter` is composed from the assignee select + specific-user value
  // (control fields, never asked directly), so its frontmatter comment is
  // stamped from here rather than from a walkthrough field.
  { path: ["linear", "filter"], description: LINEAR_FILTER_DESCRIPTION },
];
