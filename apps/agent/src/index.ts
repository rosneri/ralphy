import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { findProjectRoot } from "@ralphy/paths";
import { parseAgentArgs, printAgentHelp, type AgentParsedArgs } from "./cli";
import { AgentMode } from "./components/AgentMode";
import { shouldFallbackToJsonOutput } from "./non-tty-fallback";
import {
  tmuxAvailable,
  sessionName,
  sessionExists,
  isInsideTmux,
  getSessionStatus,
  createSession,
  attachSession,
  switchClientToSession,
  killSession,
} from "./runtime/tmux";

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printAgentHelp();
    return 0;
  }

  let args: AgentParsedArgs;
  try {
    args = await parseAgentArgs(argv);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n\n");
    printAgentHelp();
    return 1;
  }

  const projectRoot = args.projectRoot ?? (await findProjectRoot());
  const layout = projectLayout(projectRoot);
  const statesDir = layout.statesDir;
  const tasksDir = layout.tasksDir;

  if (args.mode === "list") {
    const { runList } = await import("./list");
    await runWithContext(createDefaultContext({ layout, args }), async () => {
      await runList({
        linearTeamOverride: args.linearTeam,
        linearFilterOverride: args.linearFilter,
        linearAssigneeOverride: args.linearAssignee,
        debug: args.debug,
        name: args.name,
        checks: args.checks,
        review: args.review,
        ticketTokens: args.ticketTokens,
      });
    });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }

  if (args.mode === "stop") {
    const name = sessionName(projectRoot);
    const killed = killSession(name);
    process.stdout.write(
      killed ? `Stopped agent session: ${name}\n` : `No session found: ${name}\n`,
    );
    return 0;
  }

  if (args.mode === "status") {
    const name = sessionName(projectRoot);
    const s = getSessionStatus(name);
    process.stdout.write(JSON.stringify(s) + "\n");
    return 0;
  }

  // RLF-208: validate --ticket up front so a bad identifier fails cleanly
  // before the TUI renders (the wire layer re-runs the same resolution).
  if (args.ticketTokens.length > 0) {
    const { loadRalphyConfig } = await import("./agent/config");
    const { resolveTicketNumbers, formatTicketError } =
      await import("./shared/capabilities/linear-client");
    const cfg = await loadRalphyConfig(projectRoot, args.workflowFile);
    const team = args.linearTeam || cfg.linear.team;
    try {
      resolveTicketNumbers(args.ticketTokens, team);
    } catch (err) {
      process.stderr.write(formatTicketError(err) + "\n");
      return 1;
    }
  }

  await mkdir(statesDir, { recursive: true });
  await mkdir(tasksDir, { recursive: true });
  await mkdir(join(projectRoot, ".ralph"), { recursive: true });

  if (shouldFallbackToJsonOutput(args, process.stdin.isTTY)) {
    process.stderr.write("agent: stdin is not a TTY — falling back to --json-output mode.\n");
    args = { ...args, jsonOutput: true };
  }

  if (args.jsonOutput) {
    const { runAgentJson } = await import("./agent/json-runner");
    await runWithContext(createDefaultContext({ layout, args }), () =>
      runAgentJson({ args, projectRoot, statesDir, tasksDir }),
    );
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }

  if (!args.noTmux && !process.env["RALPH_AGENT_MANAGED"] && tmuxAvailable()) {
    const name = sessionName(projectRoot);
    if (!sessionExists(name)) {
      const binPath = process.argv[1];
      if (!binPath) {
        throw new Error("cannot re-exec ralphy under tmux: process.argv[1] is empty");
      }
      const flags = argv.filter((a) => a !== "--no-tmux");
      const managedArgv = [process.execPath, binPath, "agent", ...flags];
      const env: Record<string, string> = { RALPH_AGENT_MANAGED: "1" };
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
      }
      createSession(name, managedArgv, env);
    }
    if (isInsideTmux()) {
      switchClientToSession(name);
    } else {
      attachSession(name);
    }
    return 0;
  }

  await runWithContext(createDefaultContext({ layout, args }), async () => {
    const { waitUntilExit } = render(
      createElement(AgentMode, { args, projectRoot, statesDir, tasksDir }),
    );
    await waitUntilExit();
  });

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
