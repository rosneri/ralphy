import { findProjectRoot } from "@ralphy/paths";
import { parseWorkflowPathArgs } from "@ralphy/cli-args/parse-common-args";
import {
  workflowPath,
  loadWorkflow,
  readWorkflowVersion,
  workflowNeedsUpgrade,
  type WorkflowConfig,
} from "@ralphy/workflow";
import { detectRepoIdentity } from "@ralphy/core/repo";
import { fieldsAddedSince, needsMigration } from "./migrations";
import { detectInitialValues } from "./project-detect";
import { INIT_HELP } from "./help";
import { readSetupBackup, clearSetupBackup } from "./setup-backup";
import {
  runSetupWizard,
  promptEditOrExit,
  promptResumeOrFresh,
  promptRecreateOrExit,
  promptMigrate,
  editExisting,
} from "./setup-flow";

/**
 * First-run hook used by other subcommands. No-ops (returning false) when
 * WORKFLOW.md already exists or the session is non-interactive — in the
 * non-interactive case the caller's existing `ensureWorkflow` default-write
 * still applies. Otherwise runs the wizard.
 */
export async function maybeRunSetupWizard(
  projectRoot?: string,
  workflowFile?: string,
): Promise<boolean> {
  const root = projectRoot ?? (await findProjectRoot());
  if (await Bun.file(workflowPath(root, workflowFile)).exists()) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const detected = await detectInitialValues(root);
  return runSetupWizard(root, {
    trackBackup: true,
    ...(workflowFile ? { workflowFile } : {}),
    ...(Object.keys(detected).length > 0 ? { initialValues: detected } : {}),
  });
}

/**
 * Hook used by the real-work subcommands when WORKFLOW.md is present but stale
 * or invalid (a versioned migration would rewrite it, or it no longer parses).
 * Launches the same `ralphy init` flow that repairs and persists the file, then
 * returns true so the caller can ask the user to re-run their command against
 * the upgraded file.
 *
 * No-ops (returning false) when the file is missing, already current, or the
 * session is non-interactive — in the non-interactive case the downstream
 * in-memory self-heal in `loadWorkflow` still lets the command run.
 */
export async function maybeUpgradeWorkflow(
  projectRoot?: string,
  workflowFile?: string,
): Promise<boolean> {
  const root = projectRoot ?? (await findProjectRoot());
  const path = workflowPath(root, workflowFile);
  const file = Bun.file(path);
  if (!(await file.exists())) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if (!workflowNeedsUpgrade(await file.text())) return false;

  process.stdout.write("WORKFLOW.md needs an upgrade. Starting init…\n");
  const initArgv = ["--project-root", root, ...(workflowFile ? ["--workflow", workflowFile] : [])];
  await main(initArgv);
  return true;
}

/** Entry point for the `ralphy init` subcommand. */
export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(INIT_HELP + "\n");
    return 0;
  }

  const { projectRoot: rootOverride, workflowFile } = parseWorkflowPathArgs(argv);
  const projectRoot = rootOverride ?? (await findProjectRoot());
  const path = workflowPath(projectRoot, workflowFile);
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
      ({ config } = await loadWorkflow(projectRoot, workflowFile));
    } catch {
      const choice = await promptRecreateOrExit();
      if (choice === "exit") {
        process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
        return 0;
      }
      const detectedRepo = await detectRepoIdentity(projectRoot);
      const wrote = await runSetupWizard(projectRoot, {
        ...(detectedRepo ? { detectedRepo } : {}),
        ...(workflowFile ? { workflowFile } : {}),
      });
      process.stdout.write(
        wrote ? `\n✓ Recreated ${path}\n` : `\nSetup cancelled — no file written.\n`,
      );
      return 0;
    }

    // Outdated file → offer migration (fill the diff / review all / exit).
    // Decide from the *on-disk* version: `loadWorkflow` runs the migration in
    // memory and may have already bumped `config.version` to current, which
    // would hide the very upgrade we want to surface.
    const diskVersion = readWorkflowVersion(await Bun.file(path).text());
    if (needsMigration(diskVersion)) {
      const choice = await promptMigrate(diskVersion);
      if (choice === "exit") {
        process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
        return 0;
      }
      const onlyFields = choice === "diff" ? fieldsAddedSince(diskVersion) : undefined;
      return editExisting(projectRoot, path, config, workflowFile, onlyFields);
    }

    // Up-to-date file → plain edit-or-exit.
    const choice = await promptEditOrExit();
    if (choice === "exit") {
      process.stdout.write("Exited — WORKFLOW.md unchanged.\n");
      return 0;
    }
    return editExisting(projectRoot, path, config, workflowFile);
  }

  if (!interactive) {
    // Non-interactive: fall back to writing the canonical default.
    const { ensureWorkflow } = await import("@ralphy/workflow");
    const written = await ensureWorkflow(projectRoot, workflowFile);
    process.stdout.write(`Non-interactive shell — wrote default WORKFLOW.md: ${written}\n`);
    return 0;
  }

  // Offer to resume an interrupted setup before starting a clean one.
  const backup = await readSetupBackup(projectRoot);
  if (backup) {
    const choice = await promptResumeOrFresh();
    if (choice === "resume") {
      const wrote = await runSetupWizard(projectRoot, {
        initialMode: backup.mode,
        resumeValues: backup.values,
        trackBackup: true,
        ...(workflowFile ? { workflowFile } : {}),
      });
      process.stdout.write(
        wrote ? `\n✓ Created ${path}\n` : `\nSetup cancelled — no file written.\n`,
      );
      return 0;
    }
    await clearSetupBackup(); // starting fresh — discard the stale draft
  }

  const detectedRepo = await detectRepoIdentity(projectRoot);
  const detected = await detectInitialValues(projectRoot);
  const wrote = await runSetupWizard(projectRoot, {
    trackBackup: true,
    ...(detectedRepo ? { detectedRepo } : {}),
    ...(workflowFile ? { workflowFile } : {}),
    ...(Object.keys(detected).length > 0 ? { initialValues: detected } : {}),
  });
  process.stdout.write(wrote ? `\n✓ Created ${path}\n` : `\nSetup cancelled — no file written.\n`);
  return 0;
}
