import { join } from "node:path";
import { z } from "zod";

export const RalphyConfigSchema = z
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
        label: z.string().optional(),
      })
      .default({ statuses: [] }),
  })
  .default({
    concurrency: 1,
    pollIntervalSeconds: 60,
    maxIterationsPerTask: 0,
    maxCostUsdPerTask: 0,
    engine: "claude",
    model: "opus",
    linear: { statuses: [] },
  });

export type RalphyConfig = z.infer<typeof RalphyConfigSchema>;

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
