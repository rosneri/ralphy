import { render } from "ink";
import { createElement } from "react";
import {
  workflowPath,
  normalizeWorkflowMarkdown,
  migrateWorkflowMarkdown,
  CURRENT_WORKFLOW_VERSION,
  DEFAULT_WORKFLOW_MD,
  type WorkflowConfig,
} from "@ralphy/workflow";
import { applyAnswersToWorkflow, workflowBody } from "@ralphy/workflow/wizard";
import type { SetupMode, WizardAnswers, WizardValue } from "@ralphy/workflow/wizard-types";
import { detectRepoIdentity, type RepoIdentity } from "@ralphy/core/repo";
import { SetupWizard } from "./SetupWizard";
import {
  EditOrExitPrompt,
  MigratePrompt,
  RecreateOrExitPrompt,
  ResumeOrFreshPrompt,
  type MigrateChoice,
} from "./setup-wizard/prompts";
import { pendingMigrations } from "./migrations";
import { detectInitialValues } from "./project-detect";
import { writeSetupBackup, clearSetupBackup } from "./setup-backup";

interface RunOptions {
  /** Existing WORKFLOW.md contents — when set, edits apply onto it. */
  existing?: string;
  /** Start directly in this mode, skipping the mode picker. */
  initialMode?: "quick" | "permissive" | "customized";
  /** Field-id keyed values to prefill. */
  initialValues?: Record<string, WizardValue>;
  /**
   * Full answers from a resumed (backed-up) session. Used verbatim as the
   * wizard's initial values, bypassing repo injection so saved answers win.
   */
  resumeValues?: Record<string, WizardValue>;
  /** Migration diff path: only ask these field ids. */
  onlyFields?: string[];
  /** Detected git repo — injects `repo.*` values and the link step. */
  detectedRepo?: RepoIdentity;
  /** Persist answers to `~/.ralph/setup.tmp` as the user progresses. */
  trackBackup?: boolean;
  /** Alternate WORKFLOW.md path to write to (default: `<projectRoot>/WORKFLOW.md`). */
  workflowFile?: string;
}

/**
 * Merge a detected repo into the wizard's initial values: inject the `repo.*`
 * identity (so the builder can write the block on confirm) and prefill
 * `project.name` from the repo name only when no project name is already set
 * (a fresh file, or an edit where it is blank). Returns the original values
 * untouched when nothing was detected.
 */
function withDetectedRepo(
  initial: Record<string, WizardValue> | undefined,
  repo: RepoIdentity | undefined,
): Record<string, WizardValue> | undefined {
  if (!repo) return initial;
  const values = { ...initial };
  values["repo.remote"] = repo.remote;
  values["repo.host"] = repo.host;
  values["repo.owner"] = repo.owner;
  values["repo.name"] = repo.name;
  if (!values["project.name"]) values["project.name"] = repo.name;
  return values;
}

/**
 * Clear the terminal so a fresh Ink app doesn't stack under a previous one.
 * Each `render()`/`waitUntilExit()` leaves its final frame committed to the
 * scrollback; clearing before the next render keeps the flow on one screen.
 */
function clearScreen(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

/**
 * Render the Ink wizard and write the resulting WORKFLOW.md. Returns true when
 * a file was written, false when the user cancelled. Assumes the caller has
 * already confirmed the terminal is interactive.
 */
export async function runSetupWizard(
  projectRoot: string,
  options: RunOptions = {},
): Promise<boolean> {
  let markdown: string | null = null;
  const buildMarkdown = options.existing
    ? (answers: WizardAnswers, bodyOverride?: string) =>
        applyAnswersToWorkflow(options.existing!, answers, bodyOverride)
    : undefined;
  // Pre-fill the "customize prompt" step with the body that would be written.
  const initialBody = workflowBody(options.existing ?? DEFAULT_WORKFLOW_MD);
  // A resumed session uses its saved answers verbatim; otherwise inject the
  // detected repo identity into any prefilled values.
  const initialValues: Record<string, WizardValue> | undefined =
    options.resumeValues ?? withDetectedRepo(options.initialValues, options.detectedRepo);
  clearScreen();
  const { waitUntilExit } = render(
    createElement(SetupWizard, {
      onComplete: (md: string) => {
        markdown = md;
      },
      onCancel: () => {
        markdown = null;
      },
      initialBody,
      ...(options.initialMode ? { initialMode: options.initialMode } : {}),
      ...(initialValues ? { initialValues } : {}),
      ...(options.onlyFields ? { onlyFields: options.onlyFields } : {}),
      ...(options.detectedRepo
        ? { detectedRepo: { owner: options.detectedRepo.owner, name: options.detectedRepo.name } }
        : {}),
      ...(buildMarkdown ? { buildMarkdown } : {}),
      ...(options.trackBackup
        ? {
            onAnswersChange: (state: { mode: SetupMode; values: Record<string, WizardValue> }) => {
              void writeSetupBackup(projectRoot, state.mode, state.values);
            },
          }
        : {}),
    }),
  );
  await waitUntilExit();
  if (markdown === null) return false;
  // Self-heal on write: backfill every default-bearing key and enforce the
  // confirmation-gate invariant, so a file produced by `ralphy init` always
  // carries the full key set. This is the one deliberate, single-working-copy
  // entrypoint where persisting the heal is safe (never the agent/worktree
  // hot path).
  const { markdown: healed } = normalizeWorkflowMarkdown(markdown);
  await Bun.write(workflowPath(projectRoot, options.workflowFile), healed);
  // A WORKFLOW.md now exists — discard any in-progress backup so a later run
  // doesn't offer to resume a session that already finished.
  await clearSetupBackup();
  return true;
}

/** Prefill values (keyed by wizard field id) from an existing config. */
function initialValuesFromConfig(config: WorkflowConfig): Record<string, WizardValue> {
  const values: Record<string, WizardValue> = {};
  if (config.project.name) values["project.name"] = config.project.name;
  if (config.project.language) values["project.language"] = config.project.language;
  if (config.project.framework) values["project.framework"] = config.project.framework;
  if (config.commands.test) values["commands.test"] = config.commands.test;
  if (config.commands.lint) values["commands.lint"] = config.commands.lint;
  if (config.commands.build) values["commands.build"] = config.commands.build;
  if (config.commands.typecheck) values["commands.typecheck"] = config.commands.typecheck;
  values["engine"] = config.engine;
  values["model"] = config.model;
  values["concurrency"] = config.concurrency;
  values["createPrOnSuccess"] = config.createPrOnSuccess;
  values["prBaseBranch"] = config.prBaseBranch;
  values["prRecovery.enabled"] = config.prRecovery.enabled;
  values["prRecovery.fixCi"] = config.prRecovery.fixCi;
  values["prRecovery.maxRecoverySessions"] = config.prRecovery.maxRecoverySessions;
  values["useWorktree"] = config.useWorktree;
  if (config.linear.team) values["linear.team"] = config.linear.team;
  // Carry the stored marker filter through verbatim (so label clauses survive a
  // re-run) and translate its assignee clause back into the assignee select
  // (+ specific-user value) the wizard asks. Anything other than the three
  // keywords becomes a "specific user" with its email/user-id prefilled.
  if (config.linear.filter && config.linear.filter.length > 0) {
    values["linear.filter"] = config.linear.filter;
    const assigneeMarker = config.linear.filter.find((marker) => marker.type === "assignee");
    const assignee = assigneeMarker?.value.trim() ?? "";
    if (assignee === "me" || assignee === "any" || assignee === "unassigned") {
      values["linear.assigneeChoice"] = assignee;
    } else if (assignee !== "") {
      values["linear.assigneeChoice"] = "other";
      values["linear.assigneeValue"] = assignee;
    }
  }
  return values;
}

/** Ask whether to edit the existing file or exit. */
export async function promptEditOrExit(): Promise<"edit" | "exit"> {
  let choice: "edit" | "exit" = "exit";
  clearScreen();
  const { waitUntilExit } = render(
    createElement(EditOrExitPrompt, {
      onChoice: (value: "edit" | "exit") => {
        choice = value;
      },
    }),
  );
  await waitUntilExit();
  return choice;
}

/** Ask whether to resume a backed-up setup session or start fresh. */
export async function promptResumeOrFresh(): Promise<"resume" | "fresh"> {
  let choice: "resume" | "fresh" = "fresh";
  clearScreen();
  const { waitUntilExit } = render(
    createElement(ResumeOrFreshPrompt, {
      onChoice: (value: "resume" | "fresh") => {
        choice = value;
      },
    }),
  );
  await waitUntilExit();
  return choice;
}

/** Ask whether to recreate an unreadable file or exit. */
export async function promptRecreateOrExit(): Promise<"recreate" | "exit"> {
  let choice: "recreate" | "exit" = "exit";
  clearScreen();
  const { waitUntilExit } = render(
    createElement(RecreateOrExitPrompt, {
      onChoice: (value: "recreate" | "exit") => {
        choice = value;
      },
    }),
  );
  await waitUntilExit();
  return choice;
}

/** Ask how to migrate an outdated file: fill the diff, review all, or exit. */
export async function promptMigrate(fromVersion: number): Promise<MigrateChoice> {
  let choice: MigrateChoice = "exit";
  clearScreen();
  const { waitUntilExit } = render(
    createElement(MigratePrompt, {
      fromVersion,
      toVersion: CURRENT_WORKFLOW_VERSION,
      descriptions: pendingMigrations(fromVersion).map((migration) => migration.description),
      onChoice: (value: MigrateChoice) => {
        choice = value;
      },
    }),
  );
  await waitUntilExit();
  return choice;
}

/** Run an edit/migration of the existing file, prefilled from its config. */
export async function editExisting(
  projectRoot: string,
  path: string,
  config: WorkflowConfig,
  workflowFile?: string,
  onlyFields?: string[],
): Promise<number> {
  // Migrate any pre-v6 PR-recovery keys to the `prRecovery` shape BEFORE the
  // wizard applies answers onto the text — otherwise the old keys (which the
  // wizard never touches) would survive alongside the new block. The in-memory
  // `config` is already migrated by `loadWorkflow`; this aligns the on-disk text.
  const { markdown: existing } = migrateWorkflowMarkdown(await Bun.file(path).text());
  // Re-detect so a repo-less existing file is offered the link step (backfill);
  // `withDetectedRepo` won't clobber a user-set project name.
  const detectedRepo = await detectRepoIdentity(projectRoot);
  // Autodetected values fill only the blanks — the existing config wins.
  const detected = await detectInitialValues(projectRoot);
  const wrote = await runSetupWizard(projectRoot, {
    existing,
    initialMode: "customized",
    initialValues: { ...detected, ...initialValuesFromConfig(config) },
    ...(detectedRepo ? { detectedRepo } : {}),
    ...(workflowFile ? { workflowFile } : {}),
    ...(onlyFields ? { onlyFields } : {}),
  });
  process.stdout.write(wrote ? `\n✓ Updated ${path}\n` : `\nNo changes written.\n`);
  return 0;
}
