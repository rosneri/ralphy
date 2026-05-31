import { render } from "ink";
import { createElement } from "react";
import { findProjectRoot } from "@ralphy/paths";
import { workflowPath, loadWorkflow, type WorkflowConfig } from "@ralphy/workflow";
import { applyAnswersToWorkflow, type WizardAnswers } from "@ralphy/workflow/wizard";
import { SetupWizard, EditOrExitPrompt } from "./SetupWizard";

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
    ? (answers: WizardAnswers) => applyAnswersToWorkflow(options.existing!, answers)
    : undefined;
  const { waitUntilExit } = render(
    createElement(SetupWizard, {
      onComplete: (md: string) => {
        markdown = md;
      },
      onCancel: () => {
        markdown = null;
      },
      ...(options.initialMode ? { initialMode: options.initialMode } : {}),
      ...(options.initialValues ? { initialValues: options.initialValues } : {}),
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
  if (config.linear.assignee) values["linear.assignee"] = config.linear.assignee;
  return values;
}

/** Ask whether to edit the existing file or exit. */
async function promptEditOrExit(): Promise<"edit" | "exit"> {
  let choice: "edit" | "exit" = "exit";
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
    const choice = await promptEditOrExit();
    if (choice === "exit") {
      process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
      return 0;
    }
    const { config } = await loadWorkflow(projectRoot);
    const existing = await Bun.file(path).text();
    const wrote = await runSetupWizard(projectRoot, {
      existing,
      initialMode: "customized",
      initialValues: initialValuesFromConfig(config),
    });
    process.stdout.write(wrote ? `\n✓ Updated ${path}\n` : `\nNo changes written.\n`);
    return 0;
  }

  if (!interactive) {
    // Non-interactive: fall back to writing the canonical default.
    const { ensureWorkflow } = await import("@ralphy/workflow");
    const written = await ensureWorkflow(projectRoot);
    process.stdout.write(`Non-interactive shell — wrote default WORKFLOW.md: ${written}\n`);
    return 0;
  }

  const wrote = await runSetupWizard(projectRoot);
  process.stdout.write(wrote ? `\n✓ Created ${path}\n` : `\nSetup cancelled — no file written.\n`);
  return 0;
}
