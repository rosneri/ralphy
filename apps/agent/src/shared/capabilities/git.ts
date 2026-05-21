/**
 * `git` shared capability — wraps the three worktree filesystem
 * operations the agent performs so they run through the capability shell
 * (bus events, error formatting, retry policy).
 *
 *   - `createWorktree`     — provisions a per-change git worktree. Marked
 *                            `required: true`: a failure must NEVER
 *                            resolve to `cwd === projectRoot`, the
 *                            RLF-39 invariant.
 *   - `removeWorktree`     — best-effort cleanup; non-required.
 *   - `seedWorktreeMcpConfig` — copies `.mcp.json` into the worktree;
 *                            non-required, callers swallow on failure.
 */

import { NO_RETRY, type Capability } from "./types";
import {
  createWorktree as createWorktreeImpl,
  removeWorktree as removeWorktreeImpl,
  seedWorktreeMcpConfig as seedWorktreeMcpConfigImpl,
  type GitRunner,
} from "../../agent/worktree";

export interface CreateWorktreeArgs {
  projectRoot: string;
  changeName: string;
  baseBranch: string;
  runner: GitRunner;
}

export interface RemoveWorktreeArgs {
  projectRoot: string;
  cwd: string;
  runner: GitRunner;
}

export interface SeedMcpConfigArgs {
  projectRoot: string;
  worktreeCwd: string;
}

export interface WorktreeHandle {
  cwd: string;
  branch: string;
}

function defaultFormatter(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const createWorktree: Capability<CreateWorktreeArgs, WorktreeHandle> = {
  name: "git.worktree.create",
  required: true,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: (args) =>
    createWorktreeImpl(args.projectRoot, args.changeName, args.baseBranch, args.runner),
};

export const removeWorktree: Capability<RemoveWorktreeArgs, void> = {
  name: "git.worktree.remove",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: (args) => removeWorktreeImpl(args.projectRoot, args.cwd, args.runner),
};

export const seedWorktreeMcpConfig: Capability<SeedMcpConfigArgs, void> = {
  name: "git.worktree.seedMcpConfig",
  required: false,
  retryPolicy: NO_RETRY,
  errorFormatter: defaultFormatter,
  run: (args) => seedWorktreeMcpConfigImpl(args.projectRoot, args.worktreeCwd),
};

export const git = { createWorktree, removeWorktree, seedWorktreeMcpConfig };
