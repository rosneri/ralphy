import { join } from "node:path";
import { z } from "zod";

const RalphyConfigSchema = z
  .object({
    concurrency: z.number().int().positive().default(1),
    pollIntervalSeconds: z.number().int().positive().default(60),
    maxIterationsPerTask: z.number().int().nonnegative().default(0),
    maxCostUsdPerTask: z.number().nonnegative().default(0),
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
