import { join } from "node:path";
import { exists, mkdir, rm } from "node:fs/promises";
import { render } from "ink";
import { createElement } from "react";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { findProjectRoot, worktreesDir } from "@ralphy/paths";
import { resolveOpenspecBin } from "@ralphy/openspec";
import { parseLoopArgs, printLoopHelp } from "./cli";
import { parseTaskArgs, printTaskHelp } from "./task-cli";
import { App } from "./components/App";
import { runDebug } from "./debug";

/**
 * Ensure `<projectRoot>/.ralph/.gitignore` exists and ignores the local
 * `bin/` directory (where shell.js / mcp.js get dropped when the package
 * postinstall script runs inside a worktree). Without this, those binaries
 * show up as untracked changes in `git status` and slip into commits.
 */
async function ensureRalphGitignore(projectRoot: string): Promise<void> {
  const ralphDir = join(projectRoot, ".ralph");
  await mkdir(ralphDir, { recursive: true });
  const gitignorePath = join(ralphDir, ".gitignore");
  const file = Bun.file(gitignorePath);
  if (await file.exists()) {
    const existing = await file.text();
    const lines = existing.split("\n").map((l) => l.trim());
    if (lines.includes("bin") || lines.includes("bin/")) return;
    const next = existing.endsWith("\n") ? `${existing}bin\n` : `${existing}\nbin\n`;
    await Bun.write(gitignorePath, next);
    return;
  }
  await Bun.write(gitignorePath, "bin\n");
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printLoopHelp();
    return 0;
  }

  let args;
  try {
    args = await parseLoopArgs(argv);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n\n");
    printLoopHelp();
    return 1;
  }

  const projectRoot = args.projectRoot ?? (await findProjectRoot());
  const layout = projectLayout(projectRoot);
  const statesDir = layout.statesDir;
  const tasksDir = layout.tasksDir;

  if (args.mode === "init") {
    await mkdir(statesDir, { recursive: true });
    await ensureRalphGitignore(projectRoot);
    const { ensureWorkflow } = await import("@ralphy/workflow");
    const workflowPath = await ensureWorkflow(projectRoot);
    process.stdout.write(`Workflow config: ${workflowPath}\n`);
    const openspecBin = resolveOpenspecBin(import.meta.dir);
    Bun.spawnSync({
      cmd: [process.execPath, openspecBin, "init", "--tools", "none", "--force"],
      stdio: ["inherit", "inherit", "inherit"],
      cwd: process.cwd(),
    });
  }

  if (args.mode === "debug") {
    if (!args.name) {
      process.stderr.write("Error: --name is required for debug mode\n");
      return 1;
    }
    await runDebug({ name: args.name, projectRoot });
    return 0;
  }

  if (args.mode === "clean") {
    if (!args.name) {
      process.stderr.write("Error: --name is required for clean mode\n");
      return 1;
    }
    const worktreeDir = join(worktreesDir(projectRoot), args.name);
    const changeDir = join(tasksDir, args.name);
    const stateDir = join(statesDir, args.name);
    const branch = `ralph/${args.name}`;
    const removed: string[] = [];

    if (await exists(worktreeDir)) {
      const proc = Bun.spawn({
        cmd: ["git", "worktree", "remove", "--force", worktreeDir],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      if (code !== 0) {
        await rm(worktreeDir, { recursive: true, force: true });
        await Bun.spawn({
          cmd: ["git", "worktree", "prune"],
          cwd: projectRoot,
          stdout: "ignore",
          stderr: "ignore",
        }).exited;
      }
      removed.push(`worktree ${worktreeDir}`);
    }

    const branchProc = Bun.spawn({
      cmd: ["git", "branch", "-D", branch],
      cwd: projectRoot,
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await branchProc.exited) === 0) removed.push(`branch ${branch}`);

    if (await exists(changeDir)) {
      await rm(changeDir, { recursive: true, force: true });
      removed.push(`openspec change ${changeDir}`);
    }
    if (await exists(stateDir)) {
      await rm(stateDir, { recursive: true, force: true });
      removed.push(`task state ${stateDir}`);
    }

    if (removed.length === 0) {
      process.stdout.write(`Nothing to clean for '${args.name}'\n`);
    } else {
      process.stdout.write(`Cleaned '${args.name}':\n`);
      for (const r of removed) process.stdout.write(`  ✓ removed ${r}\n`);
    }
    return 0;
  }

  if (args.mode === "task" && args.name) {
    await mkdir(join(statesDir, args.name), { recursive: true });
    await mkdir(join(tasksDir, args.name), { recursive: true });
    await ensureRalphGitignore(projectRoot);
  }

  await runWithContext(createDefaultContext(), async () => {
    const { waitUntilExit } = render(
      createElement(App, { args, statesDir, tasksDir, projectRoot }),
    );
    await waitUntilExit();
  });

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

export async function taskMain(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printTaskHelp();
    return 0;
  }

  let args;
  try {
    args = await parseTaskArgs(argv);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n\n");
    printTaskHelp();
    return 1;
  }

  const projectRoot = args.projectRoot ?? (await findProjectRoot());
  const layout = projectLayout(projectRoot);
  const statesDir = layout.statesDir;
  const tasksDir = layout.tasksDir;

  await mkdir(join(statesDir, args.name), { recursive: true });
  await mkdir(join(tasksDir, args.name), { recursive: true });
  await ensureRalphGitignore(projectRoot);

  // Build a LoopParsedArgs-compatible object to reuse App rendering
  const loopArgs = {
    mode: "task" as const,
    name: args.name,
    prompt: args.prompt,
    engine: args.engine,
    model: args.model,
    engineSet: args.engineSet,
    maxIterations: args.maxIterations,
    maxCostUsd: args.maxCostUsd,
    maxRuntimeMinutes: args.maxRuntimeMinutes,
    maxConsecutiveFailures: args.maxConsecutiveFailures,
    delay: args.delay,
    log: args.log,
    verbose: args.verbose,
    projectRoot: args.projectRoot,
    manualTest: false,
    fromAgent: args.fromAgent,
    reviewPhase: { enabled: false, maxRounds: 1, reviewerContextStrategy: "fresh" as const },
  };

  await runWithContext(createDefaultContext(), async () => {
    const { waitUntilExit } = render(
      createElement(App, {
        args: loopArgs,
        statesDir,
        tasksDir,
        projectRoot,
        taskPhase: args.phase,
      }),
    );
    await waitUntilExit();
  });

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
