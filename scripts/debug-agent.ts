#!/usr/bin/env bun
/**
 * Standalone wrapper around `ralph debug`.
 *
 * Usage:
 *   bun scripts/debug-agent.ts --name <changeName>
 *   bun scripts/debug-agent.ts --issue <IDENTIFIER>
 *   bun scripts/debug-agent.ts --name <changeName> --project-root <dir>
 */

import { runDebug } from "../apps/loop/src/debug";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const name = flag("name");
const issue = flag("issue");
const projectRoot = flag("project-root") ?? process.cwd();

if (!name && !issue) {
  console.error("Usage: debug-agent.ts --name <changeName> | --issue <IDENTIFIER>");
  process.exit(1);
}

await runDebug({ name, issue, projectRoot });
