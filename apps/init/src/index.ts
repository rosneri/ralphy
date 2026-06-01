import { render } from "ink";
import { createElement } from "react";
import { findProjectRoot } from "@ralphy/paths";
import {
  workflowPath,
  loadWorkflow,
  CURRENT_WORKFLOW_VERSION,
  DEFAULT_WORKFLOW_MD,
  type WorkflowConfig,
} from "@ralphy/workflow";
import { applyAnswersToWorkflow, workflowBody } from "@ralphy/workflow/wizard";
import type { WizardAnswers } from "@ralphy/workflow/wizard-types";
import { detectRepoIdentity, type RepoIdentity } from "@ralphy/core/repo";
import {
  SetupWizard,
  EditOrExitPrompt,
  MigratePrompt,
  RecreateOrExitPrompt,
  type MigrateChoice,
} from "./SetupWizard";
import { fieldsAddedSince, needsMigration, pendingMigrations } from "./migrations";

const INIT_HELP = [
  "ralphy init — create or edit WORKFLOW.md with an interactive setup wizard",
  "",
  "Usage: ralphy init",
  "",
  "Runs a short wizard (quick / permissive / customized) and writes WORKFLOW.md",
  "to the project root. If WORKFLOW.md already exists, offers to edit it.",
].join("\n");

interface RunOptions {
  /** Existing WORKFLOW.md contents — when set, edits apply onto it. */
  existing?: string;
  /** Start directly in this mode, skipping the mode picker. */
  initialMode?: "quick" | "permissive" | "customized";
  /** Field-id keyed values to prefill. */
  initialValues?: Record<string, string | number | boolean>;
  /** Migration diff path: only ask these field ids. */
  onlyFields?: string[];
  /** Detected git repo — injects `repo.*` values and the link step. */
  detectedRepo?: RepoIdentity;
}

/**
 * Merge a detected repo into the wizard's initial values: inject the `repo.*`
 * identity (so the builder can write the block on confirm) and prefill
 * `project.name` from the repo name only when no project name is already set
 * (a fresh file, or an edit where it is blank). Returns the original values
 * untouched when nothing was detected.
 */
function withDetectedRepo(
  initial: Record<string, string | number | boolean> | undefined,
  repo: RepoIdentity | undefined,
): Record<string, string | number | boolean> | undefined {
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
  const initialValues = withDetectedRepo(options.initialValues, options.detectedRepo);
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
    }),
  );
  await waitUntilExit();
  if (markdown === null) return false;
  await Bun.write(workflowPath(projectRoot), markdown);
  return true;
}

/**
 * First-run hook used by other subcommands. No-ops (returning false) when
 * WORKFLOW.md already exists or the session is non-interactive — in the
 * non-interactive case the caller's existing `ensureWorkflow` default-write
 * still applies. Otherwise runs the wizard.
 */
export async function maybeRunSetupWizard(projectRoot?: string): Promise<boolean> {
  const root = projectRoot ?? (await findProjectRoot());
  if (await Bun.file(workflowPath(root)).exists()) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return runSetupWizard(root);
}

/** Prefill values (keyed by wizard field id) from an existing config. */
function initialValuesFromConfig(
  config: WorkflowConfig,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
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
  values["fixCiOnFailure"] = config.fixCiOnFailure;
  values["useWorktree"] = config.useWorktree;
  if (config.linear.team) values["linear.team"] = config.linear.team;
  if (config.linear.filter) values["linear.filter"] = config.linear.filter;
  return values;
}

/** Ask whether to edit the existing file or exit. */
async function promptEditOrExit(): Promise<"edit" | "exit"> {
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

/** Ask whether to recreate an unreadable file or exit. */
async function promptRecreateOrExit(): Promise<"recreate" | "exit"> {
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
async function promptMigrate(fromVersion: number): Promise<MigrateChoice> {
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
async function editExisting(
  projectRoot: string,
  path: string,
  config: WorkflowConfig,
  onlyFields?: string[],
): Promise<number> {
  const existing = await Bun.file(path).text();
  // Re-detect so a repo-less existing file is offered the link step (backfill);
  // `withDetectedRepo` won't clobber a user-set project name.
  const detectedRepo = await detectRepoIdentity(projectRoot);
  const wrote = await runSetupWizard(projectRoot, {
    existing,
    initialMode: "customized",
    initialValues: initialValuesFromConfig(config),
    ...(detectedRepo ? { detectedRepo } : {}),
    ...(onlyFields ? { onlyFields } : {}),
  });
  process.stdout.write(wrote ? `\n✓ Updated ${path}\n` : `\nNo changes written.\n`);
  return 0;
}

/** Entry point for the `ralphy init` subcommand. */
export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(INIT_HELP + "\n");
    return 0;
  }

  const projectRoot = await findProjectRoot();
  const path = workflowPath(projectRoot);
  const exists = await Bun.file(path).exists();
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (exists) {
    if (!interactive) {
      process.stdout.write(`WORKFLOW.md already exists at ${path} — leaving it unchanged.\n`);
      return 0;
    }
    // Unreadable file (missing/malformed frontmatter) → recreate or exit.
    let config: WorkflowConfig;
    try {
      ({ config } = await loadWorkflow(projectRoot));
    } catch {
      const choice = await promptRecreateOrExit();
      if (choice === "exit") {
        process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
        return 0;
      }
      const detectedRepo = await detectRepoIdentity(projectRoot);
      const wrote = await runSetupWizard(projectRoot, detectedRepo ? { detectedRepo } : {});
      process.stdout.write(
        wrote ? `\n✓ Recreated ${path}\n` : `\nSetup cancelled — no file written.\n`,
      );
      return 0;
    }

    // Outdated file → offer migration (fill the diff / review all / exit).
    if (needsMigration(config.version)) {
      const choice = await promptMigrate(config.version);
      if (choice === "exit") {
        process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
        return 0;
      }
      const onlyFields = choice === "diff" ? fieldsAddedSince(config.version) : undefined;
      return editExisting(projectRoot, path, config, onlyFields);
    }

    // Up-to-date file → plain edit-or-exit.
    const choice = await promptEditOrExit();
    if (choice === "exit") {
      process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
      return 0;
    }
    return editExisting(projectRoot, path, config);
  }

  if (!interactive) {
    // Non-interactive: fall back to writing the canonical default.
    const { ensureWorkflow } = await import("@ralphy/workflow");
    const written = await ensureWorkflow(projectRoot);
    process.stdout.write(`Non-interactive shell — wrote default WORKFLOW.md: ${written}\n`);
    return 0;
  }

  const detectedRepo = await detectRepoIdentity(projectRoot);
  const wrote = await runSetupWizard(projectRoot, detectedRepo ? { detectedRepo } : {});
  process.stdout.write(wrote ? `\n✓ Created ${path}\n` : `\nSetup cancelled — no file written.\n`);
  return 0;
}
