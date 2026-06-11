import { basename, join } from "node:path";
import { homedir } from "node:os";
import { exists, rm } from "node:fs/promises";

export interface WorktreeHandle {
  /** Absolute path to the new working tree. */
  cwd: string;
  /** Branch name created for this worktree. */
  branch: string;
  /**
   * True when this call provisioned a brand-new worktree directory (either by
   * creating a fresh branch or by checking out an existing branch into a new
   * directory); false when an existing worktree directory was reused (resume).
   * Callers use this to run one-time-per-worktree setup (e.g. installing
   * dependencies) only on first creation, not on every resume.
   */
  created: boolean;
}

export interface GitRunner {
  /** Run a git command in the given cwd. Throws on non-zero exit with stderr in message. */
  run: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Provisions the per-change worktree during `prepare`. Extracted behind an
 * interface so the prepare/PR-open flow is drivable end-to-end in tests: the
 * production default (see `defaultWorktreeProvider` in `wire/prepare.ts`) runs
 * the real `createWorktree`, which lives under `~/.ralph/...` and touches the
 * filesystem; an injected test provider returns a temp-dir cwd so a full-wire
 * `createPr` run never reaches the real home directory.
 */
export interface WorktreeProvider {
  create(input: {
    projectRoot: string;
    changeName: string;
    baseBranch: string;
    runner: GitRunner;
  }): Promise<WorktreeHandle>;
  seedMcpConfig(input: { projectRoot: string; worktreeCwd: string }): Promise<void>;
}

/**
 * Where worktrees live for a given project.
 *
 * Located at `~/.ralph/<project-basename>/worktrees`, OUTSIDE the project
 * tree. The project tree is unsuitable because users typically gitignore
 * `.ralph/`, and tools that walk up reading `.gitignore` (cspell with
 * `useGitignore`, lint-staged, etc.) then treat anything under `.ralph/`
 * as ignored — pre-push hooks running inside a worktree there find zero
 * files and fail spuriously. Living in `~/.ralph/...` keeps worktrees
 * out of any project-level gitignore reach.
 */
export function worktreesDir(projectRoot: string): string {
  return join(homedir(), ".ralph", basename(projectRoot), "worktrees");
}

/** Branch name used for a given change-name slug. */
export function branchForChange(changeName: string): string {
  return `ralph/${changeName}`;
}

/**
 * Canonical directory name for an issue's worktree under {@link worktreesDir}.
 * Keyed on the short Linear identifier (lowercased) — not the full change-name
 * slug — so a single issue keeps the same worktree directory even when the
 * generated change-name slug changes between iterations.
 */
export function worktreeDirNameForIssue(issue: { identifier: string }): string {
  return issue.identifier.toLowerCase();
}

/**
 * Serializes worktree provisioning per repository. {@link createWorktree} runs
 * repo-mutating git commands (`fetch`, `worktree add`, `config`) against the
 * shared `projectRoot/.git`. The agent coordinator prepares queued issues
 * concurrently, so without this lock several `createWorktree` calls hit the
 * same repo at once and git's on-disk locks (`.git/worktrees`, `config.lock`,
 * `index.lock`) collide — one invocation then fails with a generic lock error
 * and the issue is spuriously quarantined. A per-`projectRoot` promise chain
 * forces provisioning to run one repo-operation at a time.
 */
const repoWorktreeLocks = new Map<string, Promise<unknown>>();

function withRepoLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoWorktreeLocks.get(projectRoot) ?? Promise.resolve();
  // Run fn after the previous holder settles — regardless of whether it
  // resolved or rejected — so one failure never wedges the queue.
  const result = prev.then(fn, fn);
  // The lock tail swallows outcomes so the next waiter chains cleanly.
  repoWorktreeLocks.set(
    projectRoot,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

/**
 * Create a new git worktree at `~/.ralph/<project>/worktrees/<changeName>` checked out
 * onto a fresh branch `ralph/<changeName>`. When the branch is being created,
 * `git fetch origin <baseBranch>` runs first and the new branch is rooted at
 * `origin/<baseBranch>` — not the local HEAD of `projectRoot` — so a stale or
 * dirty local checkout cannot leak into agent PRs. Returns the absolute
 * worktree path and branch name.
 *
 * If a worktree at that path already exists, it is reused (treated as
 * resume). If the branch already exists locally, it is checked out as-is
 * with no fetch and no silent rebase.
 *
 * Provisioning is serialized per `projectRoot` (see {@link withRepoLock}) so
 * concurrent prepares don't contend on the shared repo's git locks.
 *
 * Fails loudly when the fetch fails — better to surface a missing remote
 * than to silently fall back to local HEAD.
 */
export function createWorktree(
  projectRoot: string,
  changeName: string,
  baseBranch: string,
  runner: GitRunner,
): Promise<WorktreeHandle> {
  return withRepoLock(projectRoot, () =>
    provisionWorktree(projectRoot, changeName, baseBranch, runner),
  );
}

/**
 * Classify the `git worktree list --porcelain` entry for `cwd`:
 *   - `"live"`   — registered and usable (reuse as a resume);
 *   - `"stale"`  — registered but git flags it `prunable` (its directory was
 *                  wiped out-of-band); must be pruned before recreating;
 *   - `"absent"` — not registered at all (fresh provision).
 *
 * Porcelain emits one blank-line-separated block per worktree; a block whose
 * first line is `worktree <cwd>` and which contains a `prunable ...` line is a
 * ghost registration.
 */
function worktreeRegistration(porcelain: string, cwd: string): "live" | "stale" | "absent" {
  for (const block of porcelain.split("\n\n")) {
    const lines = block.split("\n");
    if (lines[0] !== `worktree ${cwd}`) continue;
    return lines.some((l) => l.startsWith("prunable ")) ? "stale" : "live";
  }
  return "absent";
}

async function provisionWorktree(
  projectRoot: string,
  changeName: string,
  baseBranch: string,
  runner: GitRunner,
): Promise<WorktreeHandle> {
  const dir = worktreesDir(projectRoot);
  const cwd = join(dir, changeName);
  const branch = branchForChange(changeName);

  // If the worktree directory already exists in git's worktree list, reuse it —
  // but only when it's actually live on disk. A registration can go stale: the
  // working directory gets wiped out-of-band (a manual `rm -rf`, an interrupted
  // op, OS temp cleanup) while git still lists the entry. `git worktree list
  // --porcelain` flags such a ghost with a `prunable` line. Reusing it ran git
  // commands (`config core.hooksPath`) inside a directory whose `.git` link is
  // gone — "fatal: not in a git directory" — which failed prepare and errored
  // the issue. Detect the stale entry, prune it, and fall through to recreate.
  const list = await runner.run(["worktree", "list", "--porcelain"], projectRoot);
  const registration = worktreeRegistration(list.stdout, cwd);
  if (registration === "live") {
    await installPrePushHook(cwd, runner);
    return { cwd, branch, created: false };
  }
  if (registration === "stale") {
    // Drop the dead entry so the `worktree add` below can re-claim the
    // path/branch, then clear any leftover stub directory (e.g. a half-written
    // `.ralph-hooks/`) so the recreation starts from a clean path.
    await runner.run(["worktree", "prune"], projectRoot);
    if (await exists(cwd)) await rm(cwd, { recursive: true, force: true });
  }

  // Does the branch already exist locally?
  let branchExists = true;
  try {
    await runner.run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot);
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await runner.run(["worktree", "add", cwd, branch], projectRoot);
    await installPrePushHook(cwd, runner);
    return { cwd, branch, created: true };
  }

  await runner.run(["fetch", "origin", baseBranch], projectRoot);
  await runner.run(["worktree", "add", "-b", branch, cwd, `origin/${baseBranch}`], projectRoot);
  await installPrePushHook(cwd, runner);
  return { cwd, branch, created: true };
}

/**
 * Hook script body installed into each worktree's `.ralph-hooks/pre-push`.
 *
 * Reads git's per-push stdin (`<local ref> <local sha> <remote ref> <remote sha>`)
 * and rejects pushes that target anything other than `refs/heads/ralph/*`,
 * and rejects force pushes unless `RALPH_ALLOW_FORCE_PUSH=1` is set.
 */
export const PRE_PUSH_HOOK_SCRIPT = `#!/usr/bin/env bash
# Installed by ralphy createWorktree (RLF-107).
# Rejects any push whose remote ref is not refs/heads/ralph/*,
# and rejects force pushes unless RALPH_ALLOW_FORCE_PUSH=1.
set -euo pipefail
ZERO="0000000000000000000000000000000000000000"
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/ralph/*) ;;
    *) echo "ralph: refusing push to $remote_ref (only refs/heads/ralph/* allowed)" >&2; exit 1 ;;
  esac
  if [ "$remote_sha" != "$ZERO" ] && [ "\${RALPH_ALLOW_FORCE_PUSH:-0}" != "1" ]; then
    if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
      echo "ralph: refusing force-push to $remote_ref (set RALPH_ALLOW_FORCE_PUSH=1 to override)" >&2
      exit 1
    fi
  fi
done
exit 0
`;

/**
 * Install the per-worktree pre-push hook that constrains worker subprocesses
 * to pushing only `refs/heads/ralph/*` and (by default) non-force pushes.
 *
 * Idempotent: overwrites any existing file with the canonical script, marks
 * it executable, and points the worktree's `core.hooksPath` at the directory.
 * Called from every return path of `createWorktree` so that resumed worktrees
 * pick up the hook on the next iteration.
 */
export async function installPrePushHook(cwd: string, runner: GitRunner): Promise<void> {
  const hookPath = join(cwd, ".ralph-hooks", "pre-push");
  await Bun.write(hookPath, PRE_PUSH_HOOK_SCRIPT);
  const chmod = Bun.spawn(["chmod", "+x", hookPath]);
  await chmod.exited;
  await runner.run(["config", "core.hooksPath", ".ralph-hooks"], cwd);
}

/**
 * Remove a worktree (and prune any stale entries). Best-effort: a failure
 * here should not block higher-level cleanup, so callers typically swallow
 * the error and log instead.
 */
export async function removeWorktree(
  projectRoot: string,
  cwd: string,
  runner: GitRunner,
): Promise<void> {
  await runner.run(["worktree", "remove", "--force", cwd], projectRoot);
}

interface WorktreeCleanupCheck {
  safe: boolean;
  /** Why removal is unsafe (only set when safe=false). */
  reason?: string;
  /** `git status --porcelain` output (uncommitted/untracked entries). */
  dirty: string;
  /** `git log <base>..HEAD --oneline` output (commits not on base). */
  unpushedCommits: string;
}

/**
 * Decide whether a worktree is safe to delete. A worktree is only safe to
 * remove when both:
 *   - the working tree is fully clean (no uncommitted or untracked files),
 *   - there are no commits ahead of `base` (so nothing was produced that
 *     hasn't already been merged or PR'd).
 *
 * If either check fails, callers MUST preserve the worktree — `git worktree
 * remove --force` would otherwise destroy unsaved work.
 */
export async function isWorktreeSafeToRemove(
  cwd: string,
  base: string,
  runner: GitRunner,
): Promise<WorktreeCleanupCheck> {
  const status = await runner.run(["status", "--porcelain"], cwd);
  const dirty = status.stdout.trim();

  let unpushedCommits = "";
  try {
    const log = await runner.run(["log", "--oneline", `${base}..HEAD`, "--no-merges"], cwd);
    unpushedCommits = log.stdout.trim();
  } catch {
    // base may not be reachable from HEAD (e.g. detached / unrelated histories).
    // Treat as "has commits we don't understand" — i.e. unsafe to delete.
    unpushedCommits = "<unknown: failed to compare against base>";
  }

  if (dirty && unpushedCommits) {
    return {
      safe: false,
      reason: "uncommitted changes AND unpushed commits present",
      dirty,
      unpushedCommits,
    };
  }
  if (dirty) {
    return {
      safe: false,
      reason: "uncommitted or untracked files present",
      dirty,
      unpushedCommits,
    };
  }
  if (unpushedCommits) {
    return {
      safe: false,
      reason: `commits ahead of ${base} were not pushed/PR'd`,
      dirty,
      unpushedCommits,
    };
  }
  return { safe: true, dirty, unpushedCommits };
}

/**
 * Seed the worktree's `.mcp.json` so engines spawned inside the worktree see
 * the ralphy MCP server. `.ralph/bin/mcp.js` is gitignored, so any relative
 * `.ralph/...` arg in the worktree's `.mcp.json` won't resolve from inside
 * the worktree.
 *
 * Read whichever `.mcp.json` is available (preferring the worktree's own
 * checked-in copy, falling back to the project root's), rewrite any
 * relative `.ralph/...` args to absolute paths under `projectRoot`, and
 * write the result into the worktree. No-op if neither exists.
 */
export async function seedWorktreeMcpConfig(
  projectRoot: string,
  worktreeCwd: string,
): Promise<void> {
  const dst = join(worktreeCwd, ".mcp.json");
  const src = join(projectRoot, ".mcp.json");
  const source = (await exists(dst)) ? dst : (await exists(src)) ? src : null;
  if (!source) return;
  let parsed: { mcpServers?: Record<string, { args?: unknown[] }> };
  try {
    parsed = await Bun.file(source).json();
  } catch {
    return;
  }
  const servers = parsed.mcpServers;
  if (servers && typeof servers === "object") {
    for (const cfg of Object.values(servers)) {
      if (Array.isArray(cfg.args)) {
        cfg.args = cfg.args.map((a) =>
          typeof a === "string" && a.startsWith(".ralph/") ? join(projectRoot, a) : a,
        );
      }
    }
  }
  await Bun.write(dst, JSON.stringify(parsed, null, 2) + "\n");
}
