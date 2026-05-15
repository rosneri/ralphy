#!/usr/bin/env bun

if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
  process.stderr.write(
    "ralphy requires the Bun runtime (https://bun.sh/). It is not compatible with plain Node.js.\n" +
      "Install Bun and re-run with `bun` or `bunx ralphy`.\n",
  );
  process.exit(1);
}

import * as telemetry from "@ralphy/telemetry";
import { VERSION } from "@ralphy/version";

const SUBCOMMANDS = new Set<string>(["loop", "agent"]);

const HELP = [
  `ralphy v${VERSION}`,
  "",
  "Usage: ralphy <subcommand> [options]",
  "",
  "Subcommands:",
  "  loop      Run the iterative task loop (task, list, status, init, clean, debug)",
  "  agent     Poll Linear and dispatch task loops concurrently",
  "",
  "Run `ralphy <subcommand> --help` for subcommand-specific options.",
].join("\n");

async function dispatch(subcommand: string, rest: string[]): Promise<number> {
  if (subcommand === "loop") {
    const { main } = await import("@ralphy/loop");
    return main(rest);
  }
  if (subcommand === "agent") {
    const { main } = await import("@ralphy/agent");
    return main(rest);
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
  telemetry.capture("command_run", { subcommand });
  try {
    const code = await dispatch(subcommand, argv.slice(1));
    telemetry.capture("command_exit", { subcommand, exit_code: code });
    return code;
  } catch (err) {
    telemetry.captureError("command_error", err, { subcommand });
    throw err;
  } finally {
    await telemetry.shutdown();
  }
}

const exitCode = await run();
process.exit(exitCode);
