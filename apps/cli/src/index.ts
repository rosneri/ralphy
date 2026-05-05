#!/usr/bin/env bun

if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
  process.stderr.write(
    "ralph requires the Bun runtime (https://bun.sh/). It is not compatible with plain Node.js.\n" +
      "Install Bun and re-run with `bun` or `bunx ralphy`.\n",
  );
  process.exit(1);
}

import { resolve, join, dirname } from "node:path";
import { exists, mkdir, rm } from "node:fs/promises";
import { render } from "ink";
import { createElement } from "react";
import { parseArgs, printHelp, type ParsedArgs } from "./cli";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { App } from "./components/App";
import { readAgentState, writeAgentState } from "./agent/state";
import { worktreesDir } from "./agent/worktree";
import * as telemetry from "@ralphy/telemetry";

/**
 * Find the project root by walking up from cwd looking for an openspec/ directory.
 * Falls back to cwd if not found.
 */
async function findProjectRoot(): Promise<string> {
  let dir = process.cwd();
  while (dir !== "/") {
    if (await exists(join(dir, "openspec"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

await telemetry.init();

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  telemetry.capture("help_shown", { trigger: "empty_args" });
  await telemetry.shutdown();
  printHelp();
  process.exit(0);
}

if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  telemetry.capture("help_shown", { trigger: "explicit" });
  await telemetry.shutdown();
  printHelp();
  process.exit(0);
}

let args: ParsedArgs;
try {
  args = await parseArgs(rawArgs);
} catch (err) {
  telemetry.capture("help_shown", { trigger: "bad_args" });
  await telemetry.shutdown();
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n\n");
  printHelp();
  process.exit(1);
}

telemetry.capture("command_run", { mode: args.mode, engine: args.engine, model: args.model });

try {
  const projectRoot = await findProjectRoot();
  const statesDir = join(projectRoot, ".ralph", "tasks");
  const tasksDir = join(projectRoot, "openspec", "changes");

  if (args.mode === "init") {
    await mkdir(statesDir, { recursive: true });
    const openspecBin = join(
      dirname(Bun.resolveSync("@fission-ai/openspec/package.json", import.meta.dir)),
      "bin",
      "openspec.js",
    );
    Bun.spawnSync({
      cmd: [process.execPath, openspecBin, "init", "--tools", "none", "--force"],
      stdio: ["inherit", "inherit", "inherit"],
      cwd: process.cwd(),
    });
  }

  if (args.mode === "clean") {
    if (!args.name) {
      process.stderr.write("Error: --name is required for clean mode\n");
      process.exit(1);
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

    // Drop the corresponding agent-state.json entry so the ticket can be
    // picked up cleanly on the next agent poll. The map is keyed by Linear
    // identifier; we look up by changeName.
    try {
      const agentState = await readAgentState(projectRoot);
      const entry = Object.values(agentState.tasks).find((t) => t.changeName === args.name);
      if (entry) {
        delete agentState.tasks[entry.identifier];
        await writeAgentState(projectRoot, agentState);
        removed.push(`agent-state entry for ${entry.identifier} (${entry.issueId})`);
      }
    } catch {
      /* agent-state.json may not exist; nothing to scrub */
    }

    if (removed.length === 0) {
      process.stdout.write(`Nothing to clean for '${args.name}'\n`);
    } else {
      process.stdout.write(`Cleaned '${args.name}':\n`);
      for (const r of removed) process.stdout.write(`  ✓ removed ${r}\n`);
    }
    await telemetry.shutdown();
    process.exit(0);
  }

  if (args.mode === "task" && args.name) {
    await mkdir(join(statesDir, args.name), { recursive: true });
    await mkdir(join(tasksDir, args.name), { recursive: true });
  }

  if (args.mode === "agent") {
    await mkdir(statesDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });
    await mkdir(join(projectRoot, ".ralph"), { recursive: true });
  }

  await runWithContext(createDefaultContext(), async () => {
    const { waitUntilExit } = render(
      createElement(App, { args, statesDir, tasksDir, projectRoot }),
    );
    await waitUntilExit();
  });
  await telemetry.shutdown();
} catch (err) {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exit(1);
}
