import { join } from "node:path";
import { z } from "zod";

const RalphyConfigSchema = z
  .object({
    concurrency: z.number().int().positive().default(1),
    pollIntervalSeconds: z.number().int().positive().default(60),
    maxIterationsPerTask: z.number().int().nonnegative().default(0),
    maxCostUsdPerTask: z.number().nonnegative().default(0),
    // When true, every task runs in a per-issue git worktree under
    // .ralph/worktrees/<change-name> on a fresh `ralph/<change-name>` branch.
    useWorktree: z.boolean().default(false),
    // Whether to remove the worktree (and its branch is left intact) when
    // the task exits cleanly. Failed tasks always keep the worktree for
    // human inspection. Ignored when useWorktree is false.
    cleanupWorktreeOnSuccess: z.boolean().default(false),
    // Shell command to run after a worktree is created and the change is
    // scaffolded, but before the task loop starts. Runs in the worktree
    // (or project root if useWorktree is false). Use this to install
    // dependencies, copy .env files, etc.
    setupScript: z.string().optional(),
    // Shell command to run after the task loop exits, before any worktree
    // teardown. Runs in the same cwd as setupScript. Failures are logged
    // but never block.
    teardownScript: z.string().optional(),
    // Text appended to every scaffolded proposal.md under an "Additional
    // instructions" section. Use for cross-cutting guidance you want every
    // task to see (e.g. "Always run lint before committing").
    appendPrompt: z.string().optional(),
    // When true, push the worker's branch and open a GitHub PR via `gh`
    // after the task loop exits cleanly. Requires useWorktree (the PR
    // needs a branch to point at) and a configured GitHub remote. The
    // PR URL is then included in the Linear completion comment.
    createPrOnSuccess: z.boolean().default(false),
    // Base branch for the PR (default "main").
    prBaseBranch: z.string().default("main"),
    engine: z.enum(["claude", "codex"]).default("claude"),
    model: z.enum(["haiku", "sonnet", "opus"]).default("opus"),
    linear: z
      .object({
        team: z.string().optional(),
        assignee: z.string().optional(),
        statuses: z.array(z.string()).default([]),
        // Match any-of these label names. Single string in old configs is
        // accepted and coerced to a 1-element array.
        labels: z
          .union([z.array(z.string()), z.string()])
          .transform((v) => (typeof v === "string" ? [v] : v))
          .default([]),
        // Status name to move issues to when ralph starts working on them.
        inProgressStatus: z.string().optional(),
        // Status name to move issues to after a successful run.
        doneStatus: z.string().optional(),
        // Label name to add to the issue after a successful run.
        // Useful when your team marks done via a label rather than a state.
        doneLabel: z.string().optional(),
        // Whether to post progress comments on the Linear issue.
        postComments: z.boolean().default(true),
        // Post a progress update on the Linear issue every N task
        // iterations. 0 disables. Requires postComments to be true.
        updateEveryIterations: z.number().int().nonnegative().default(10),
      })
      .default({ statuses: [], labels: [], postComments: true }),
  })
  .default({
    concurrency: 1,
    pollIntervalSeconds: 60,
    maxIterationsPerTask: 0,
    maxCostUsdPerTask: 0,
    engine: "claude",
    model: "opus",
    linear: { statuses: [], labels: [], postComments: true },
  });

type RalphyConfig = z.infer<typeof RalphyConfigSchema>;

export async function loadRalphyConfig(projectRoot: string): Promise<RalphyConfig> {
  const path = join(projectRoot, "ralphy.config.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return RalphyConfigSchema.parse({});
  }
  const raw = await file.json();
  return RalphyConfigSchema.parse(raw);
}

export async function ensureRalphyConfig(projectRoot: string): Promise<string> {
  const path = join(projectRoot, "ralphy.config.json");
  const file = Bun.file(path);
  if (await file.exists()) return path;
  const defaults: RalphyConfig = RalphyConfigSchema.parse({});
  await Bun.write(path, JSON.stringify(defaults, null, 2) + "\n");
  return path;
}
