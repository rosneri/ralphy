import { join } from "node:path";
import { exists, mkdir, rm } from "node:fs/promises";
import { render } from "ink";
import { createElement } from "react";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { findProjectRoot, worktreesDir } from "@ralphy/paths";
import { resolveOpenspecBin } from "@ralphy/openspec";
import { parseArgs, printHelp } from "./cli";
import { App } from "./components/App";
import { runDebug } from "./debug";

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  let args;
  try {
    args = await parseArgs(argv);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n\n");
    printHelp();
    return 1;
  }

  const projectRoot = args.projectRoot ?? (await findProjectRoot());
  const layout = projectLayout(projectRoot);
  const statesDir = layout.statesDir;
  const tasksDir = layout.tasksDir;

  if (args.mode === "init") {
    await mkdir(statesDir, { recursive: true });
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
  }

  await runWithContext(createDefaultContext(), async () => {
    const { waitUntilExit } = render(
      createElement(App, { args, statesDir, tasksDir, projectRoot }),
    );
    await waitUntilExit();
  });

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
