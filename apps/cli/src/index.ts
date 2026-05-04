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
    // Resolve --name. Accepts:
    //   - the change-name slug (e.g. "cod-27-add-feedback-…")
    //   - the Linear identifier (e.g. "COD-27")
    //   - the Linear issue UUID
    // Identifier/UUID are looked up via changeMeta in agent-state.json.
    let resolvedName = args.name;
    try {
      const s = await readAgentState(projectRoot);
      if (!s.changeMeta[args.name]) {
        const lower = args.name.toLowerCase();
        for (const [changeName, m] of Object.entries(s.changeMeta)) {
          if (m.identifier.toLowerCase() === lower || m.issueId === args.name) {
            resolvedName = changeName;
            break;
          }
        }
      }
    } catch {
      /* no agent-state.json — fall through with raw name */
    }
    if (resolvedName !== args.name) {
      process.stdout.write(`Resolved '${args.name}' → '${resolvedName}'\n`);
    }
    const worktreeDir = join(projectRoot, ".ralph", "worktrees", resolvedName);
    const changeDir = join(tasksDir, resolvedName);
    const stateDir = join(statesDir, resolvedName);
    const branch = `ralph/${resolvedName}`;
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

    // Scrub the corresponding Linear issue id from agent-state.json so the
    // ticket can be picked up cleanly on the next agent poll.
    try {
      const agentState = await readAgentState(projectRoot);
      const meta = agentState.changeMeta[resolvedName];
      // Build a set of ids to remove. Always include the changeMeta entry's
      // issueId when present. Additionally, if --name itself looks like a
      // UUID, treat it as an issue id directly — handles entries that
      // pre-date the changeMeta map (older agent runs).
      const idsToRemove = new Set<string>();
      if (meta) idsToRemove.add(meta.issueId);
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        args.name,
      );
      if (looksLikeUuid) idsToRemove.add(args.name);

      if (idsToRemove.size > 0) {
        const before = {
          processed: agentState.processedIssueIds.length,
          started: agentState.startedIssueIds.length,
          failed: agentState.failedIssueIds.length,
        };
        agentState.processedIssueIds = agentState.processedIssueIds.filter(
          (id) => !idsToRemove.has(id),
        );
        agentState.startedIssueIds = agentState.startedIssueIds.filter(
          (id) => !idsToRemove.has(id),
        );
        agentState.failedIssueIds = agentState.failedIssueIds.filter((id) => !idsToRemove.has(id));
        if (meta) delete agentState.changeMeta[resolvedName];
        const changed =
          before.processed !== agentState.processedIssueIds.length ||
          before.started !== agentState.startedIssueIds.length ||
          before.failed !== agentState.failedIssueIds.length ||
          meta !== undefined;
        if (changed) {
          await writeAgentState(projectRoot, agentState);
          const label = meta ? `${meta.identifier} (${meta.issueId})` : [...idsToRemove].join(", ");
          removed.push(`agent-state entry for ${label}`);
        }
      }
    } catch {
      /* agent-state.json may not exist; nothing to scrub */
    }

    if (removed.length === 0) {
      process.stdout.write(`Nothing to clean for '${resolvedName}'\n`);
    } else {
      process.stdout.write(`Cleaned '${resolvedName}':\n`);
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
