import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { projectLayout } from "@ralphy/core/layout";
import { findProjectRoot } from "@ralphy/paths";
import { parseArgs, printHelp } from "./cli";
import { AgentMode } from "./components/AgentMode";

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
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

  await mkdir(statesDir, { recursive: true });
  await mkdir(tasksDir, { recursive: true });
  await mkdir(join(projectRoot, ".ralph"), { recursive: true });

  if (args.jsonOutput) {
    const { runAgentJson } = await import("./agent/json-runner");
    await runAgentJson({ args, projectRoot, statesDir, tasksDir });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }

  await runWithContext(createDefaultContext(), async () => {
    const { waitUntilExit } = render(
      createElement(AgentMode, { args, projectRoot, statesDir, tasksDir }),
    );
    await waitUntilExit();
  });

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
