import { render } from "ink";
import { createElement } from "react";
import { findProjectRoot } from "@ralphy/paths";
import { workflowPath } from "@ralphy/workflow";
import { SetupWizard } from "./SetupWizard";

const INIT_HELP = [
  "ralphy init — create WORKFLOW.md with an interactive setup wizard",
  "",
  "Usage: ralphy init",
  "",
  "Runs a short wizard (quick / permissive / customized) and writes WORKFLOW.md",
  "to the project root. Does nothing if WORKFLOW.md already exists.",
].join("\n");

/**
 * Render the Ink wizard and write the resulting WORKFLOW.md. Returns true when
 * a file was written, false when the user cancelled. Assumes the caller has
 * already checked that the file is missing and the terminal is interactive.
 */
export async function runSetupWizard(projectRoot: string): Promise<boolean> {
  let markdown: string | null = null;
  const { waitUntilExit } = render(
    createElement(SetupWizard, {
      onComplete: (md: string) => {
        markdown = md;
      },
      onCancel: () => {
        markdown = null;
      },
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

/** Entry point for the `ralphy init` subcommand. */
export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(INIT_HELP + "\n");
    return 0;
  }

  const projectRoot = await findProjectRoot();
  const path = workflowPath(projectRoot);

  if (await Bun.file(path).exists()) {
    process.stdout.write(
      `WORKFLOW.md already exists at ${path}\n` +
        `Delete it first if you want to re-run the setup wizard.\n`,
    );
    return 0;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
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
