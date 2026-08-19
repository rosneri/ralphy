#!/usr/bin/env bun

if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
  process.stderr.write(
    "ralphy requires the Bun runtime (https://bun.sh/). It is not compatible with plain Node.js.\n" +
      "Install Bun and re-run with `bun` or `bunx ralphy`.\n",
  );
  process.exit(1);
}

import * as telemetry from "@ralphy/telemetry";
import { attachDefaults, createBus, setProcessBus } from "@ralphy/events";
import { VERSION } from "@ralphy/version";
import { parseWorkflowPathArgs } from "@ralphy/cli-args";

const SUBCOMMANDS = new Set<string>(["init", "loop", "agent", "task", "tokenade"]);

/** Subcommands that operate on WORKFLOW.md and should trigger first-run setup. */
const CONFIG_SUBCOMMANDS = new Set<string>(["loop", "agent", "task"]);

/** Positional modes that don't need a WORKFLOW.md (skip the first-run wizard). */
const NON_CONFIG_MODES = new Set<string>(["stop", "status", "clean", "debug", "list", "init"]);

const HELP = [
  `ralphy v${VERSION}`,
  "",
  "Usage: ralphy <subcommand> [options]",
  "",
  "Subcommands:",
  "  init      Create WORKFLOW.md via an interactive setup wizard",
  "  loop      Run the iterative task loop (task, list, status, init, clean, debug)",
  "  agent     Poll Linear and dispatch task loops concurrently",
  "  task      Run a single phase (research, plan, execute, review)",
  "  tokenade  Run the bundled Tokenade CLI (setup: `ralphy tokenade install`, then `login`)",
  "",
  "Run `ralphy <subcommand> --help` for subcommand-specific options.",
].join("\n");

/**
 * Whether a real-work invocation should get the first-run setup wizard when
 * WORKFLOW.md is missing. Excludes utility modes (stop/status/clean/…) by
 * peeking the first positional argument.
 */
function shouldOfferSetup(subcommand: string, rest: string[]): boolean {
  if (!CONFIG_SUBCOMMANDS.has(subcommand)) return false;
  const firstPositional = rest.find((arg) => !arg.startsWith("-"));
  if (firstPositional && NON_CONFIG_MODES.has(firstPositional)) return false;
  return true;
}

async function dispatch(subcommand: string, rest: string[]): Promise<number> {
  if (subcommand === "init") {
    const { main } = await import("@ralphy/init");
    return main(rest);
  }
  if (subcommand === "loop") {
    const { main } = await import("@ralphy/loop");
    return main(rest);
  }
  if (subcommand === "agent") {
    const { main } = await import("@ralphy/agent");
    return main(rest);
  }
  if (subcommand === "task") {
    const { taskMain } = await import("@ralphy/loop");
    return taskMain(rest);
  }
  if (subcommand === "tokenade") {
    // Passthrough. Tokenade ships as an optional dependency, and npm does not
    // link a dependency's bin onto PATH — so this is how a human reaches the
    // bundled copy to run its one-time `install` / `login` setup.
    const { runTokenadePassthrough } = await import("@ralphy/engine/tokenade");
    return runTokenadePassthrough(rest);
  }
  process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${HELP}\n`);
  return 1;
}

async function run(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  const subcommand = argv[0] ?? "";
  if (!SUBCOMMANDS.has(subcommand)) {
    process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${HELP}\n`);
    return 1;
  }

  await telemetry.init();
  telemetry.setDefaultProperties({ subcommand });
  const bus = createBus();
  setProcessBus(bus);
  const detachBus = attachDefaults({ bus });
  telemetry.capture("command_run", { subcommand });
  bus.emit({ type: "command_run", subcommand });
  try {
    if (CONFIG_SUBCOMMANDS.has(subcommand)) {
      try {
        const { maybeRunSetupWizard, maybeUpgradeWorkflow } = await import("@ralphy/init");
        const { projectRoot, workflowFile } = parseWorkflowPathArgs(argv.slice(1));
        // Missing file → first-run setup wizard (skipped for utility modes).
        if (shouldOfferSetup(subcommand, argv.slice(1))) {
          await maybeRunSetupWizard(projectRoot, workflowFile);
        }
        // Present but stale/invalid → start init to repair + persist, then ask
        // the user to re-run rather than dispatching against a just-changed file.
        if (await maybeUpgradeWorkflow(projectRoot, workflowFile)) {
          process.stdout.write("\nWORKFLOW.md updated — re-run your command.\n");
          telemetry.capture("command_exit", { subcommand, exit_code: 0 });
          bus.emit({ type: "command_exit", subcommand, exit_code: 0 });
          return 0;
        }
      } catch (setupErr) {
        // First-run setup / upgrade is best-effort; downstream `ensureWorkflow`
        // and the in-memory self-heal in `loadWorkflow` still let work proceed.
        telemetry.captureError("setup_wizard_error", setupErr, { subcommand });
      }
    }
    const code = await dispatch(subcommand, argv.slice(1));
    telemetry.capture("command_exit", { subcommand, exit_code: code });
    bus.emit({ type: "command_exit", subcommand, exit_code: code });
    return code;
  } catch (err) {
    telemetry.captureError("command_error", err, { subcommand });
    const e = err instanceof Error ? err : new Error(String(err));
    bus.emit({
      type: "command_error",
      subcommand,
      error_message: e.message,
      error_name: e.name,
      ...(e.stack ? { error_stack: e.stack } : {}),
    });
    throw err;
  } finally {
    detachBus();
    setProcessBus(null);
    await telemetry.shutdown();
  }
}

const exitCode = await run();
process.exit(exitCode);
