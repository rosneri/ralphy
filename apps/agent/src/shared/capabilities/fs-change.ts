/**
 * `fs-change` shared capability — bundles every direct filesystem write
 * the agent performs against an `openspec/changes/<name>/` directory so
 * they run through the standard capability shell.
 *
 * Three operations are exposed, one `Capability` each:
 *   - `scaffold`     — writes `proposal.md`, `tasks.md`, `design.md` for a
 *                      freshly-scaffolded change directory (idempotent).
 *   - `prependTask`  — prepends a timestamped `## <heading>` section to
 *                      `tasks.md` (delegates to `prependFixTask`).
 *   - `appendSteering` — appends a steering note to `steering.md`,
 *                      newest-first, creating the file when missing.
 *
 * Each capability is non-`required`: filesystem writes are not on the
 * RLF-39 invariant path. The shell still rethrows on terminal failure so
 * the caller can decide whether to swallow or surface the error.
 */

import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { prependFixTask } from "@ralphy/core/tasks-md";
import { NO_RETRY, type Capability } from "./types";

export interface ScaffoldArgs {
  /** Absolute path to `openspec/changes/<name>/`. */
  changeDir: string;
  /** Absolute path to `<statesDir>/<name>/`. */
  stateDir: string;
  /** Final content for `proposal.md`. */
  proposal: string;
  /** Final content for `tasks.md`. */
  tasks: string;
  /** Final content for `design.md`. */
  design: string;
}

export interface PrependTaskArgs {
  /** Absolute path to the target `tasks.md` (or `agent-tasks.md`). */
  tasksPath: string;
  heading: string;
  failureOutput: string;
}

export interface AppendSteeringArgs {
  /** Absolute path to `openspec/changes/<name>/`. */
  changeDir: string;
  message: string;
}

function defaultFormatter(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const scaffold: Capability<ScaffoldArgs, void> = {
  name: "fs.change.scaffold",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: async (args) => {
    await mkdir(args.changeDir, { recursive: true });
    await mkdir(join(args.changeDir, "specs"), { recursive: true });
    await mkdir(args.stateDir, { recursive: true });
    await Bun.write(join(args.changeDir, "proposal.md"), args.proposal);
    await Bun.write(join(args.changeDir, "tasks.md"), args.tasks);
    await Bun.write(join(args.changeDir, "design.md"), args.design);
  },
};

export const prependTask: Capability<PrependTaskArgs, void> = {
  name: "fs.change.task.prepend",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: async (args) => {
    await prependFixTask(args.tasksPath, args.heading, args.failureOutput);
  },
};

export const appendSteering: Capability<AppendSteeringArgs, void> = {
  name: "fs.change.steering.append",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: async (args) => {
    const path = join(args.changeDir, "steering.md");
    const f = Bun.file(path);
    const existing = (await f.exists()) ? await f.text() : null;
    const updated = existing ? `${args.message}\n\n${existing.trimStart()}` : `${args.message}\n`;
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, updated);
  },
};

export const fsChange = { scaffold, prependTask, appendSteering };
