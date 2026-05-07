import { join } from "node:path";
import { z } from "zod";

const MarkerSchema = z.object({
  type: z.enum(["label", "status"]),
  value: z.string().min(1),
});

const GetIndicatorSchema = z.object({
  filter: z.array(MarkerSchema).default([]),
});

const SetIndicatorSchema = z.union([
  MarkerSchema,
  z.object({ apply: z.array(MarkerSchema).min(1) }),
]);

/**
 * Linear is the single source of truth for which issues Ralph has touched.
 * Every action ralph performs against an issue is named here:
 *
 *   - `getTodo` — issues to pick up.
 *   - `getInProgress` — issues to resume after restart.
 *   - `getConflicted` — issues whose PR has merge conflicts.
 *   - `setInProgress` — applied when worker spawns.
 *   - `setDone` — applied on clean success.
 *   - `setError` — applied on non-zero exit (quarantine).
 *   - `setConflicted` — applied when a PR conflict is detected.
 *   - `clearConflicted` — label-only marker(s) removed once conflict is fixed.
 */
const IndicatorsSchema = z
  .object({
    getTodo: GetIndicatorSchema.optional(),
    getInProgress: GetIndicatorSchema.optional(),
    getConflicted: GetIndicatorSchema.optional(),
    setInProgress: SetIndicatorSchema.optional(),
    setDone: SetIndicatorSchema.optional(),
    setError: SetIndicatorSchema.optional(),
    setConflicted: SetIndicatorSchema.optional(),
    clearConflicted: SetIndicatorSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // clearConflicted only meaningfully removes labels — Linear statuses
    // are mutually exclusive (you set one to leave another), so removing a
    // status marker is nonsensical. Validate at parse time so misconfigs
    // surface immediately.
    const clear = value.clearConflicted;
    if (!clear) return;
    const markers = "apply" in clear ? clear.apply : [clear];
    for (const m of markers) {
      if (m.type !== "label") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clearConflicted"],
          message: "clearConflicted markers must be label-typed (status removal is not supported)",
        });
        return;
      }
    }
  });

const RalphyConfigSchema = z
  .object({
    concurrency: z.number().int().positive().default(1),
    pollIntervalSeconds: z.number().int().positive().default(60),
    maxIterationsPerTask: z.number().int().nonnegative().default(0),
    maxCostUsdPerTask: z.number().nonnegative().default(0),
    maxRuntimeMinutesPerTask: z.number().nonnegative().default(0),
    maxConsecutiveFailuresPerTask: z.number().int().nonnegative().default(5),
    iterationDelaySeconds: z.number().int().nonnegative().default(0),
    logRawStream: z.boolean().default(false),
    taskVerbose: z.boolean().default(false),
    useWorktree: z.boolean().default(false),
    cleanupWorktreeOnSuccess: z.boolean().default(false),
    setupScript: z.string().optional(),
    teardownScript: z.string().optional(),
    appendPrompt: z.string().optional(),
    createPrOnSuccess: z.boolean().default(false),
    prBaseBranch: z.string().default("main"),
    fixCiOnFailure: z.boolean().default(false),
    maxCiFixAttempts: z.number().int().positive().default(5),
    ciPollIntervalSeconds: z.number().int().positive().default(30),
    engine: z.enum(["claude", "codex"]).default("claude"),
    model: z.enum(["haiku", "sonnet", "opus"]).default("opus"),
    linear: z
      .object({
        team: z.string().optional(),
        assignee: z.string().optional(),
        // Whether to post progress comments on the Linear issue.
        postComments: z.boolean().default(true),
        // Post a progress update on the Linear issue every N task
        // iterations. 0 disables. Requires postComments to be true.
        updateEveryIterations: z.number().int().nonnegative().default(10),
        /**
         * Action map. Keys name the lifecycle event; values are typed
         * markers (label/status) to query or apply. See {@link IndicatorsSchema}.
         */
        indicators: IndicatorsSchema.default({}),
      })
      .passthrough()
      .superRefine((value, ctx) => {
        // Legacy keys (pre-indicators schema). Reject loudly with a
        // migration hint instead of silently stripping — a config with
        // both shapes is ambiguous and a config with only the legacy
        // shape would silently stop working otherwise.
        const LEGACY_KEYS = [
          "statuses",
          "labels",
          "inProgressStatus",
          "doneStatus",
          "doneLabel",
        ] as const;
        const found = LEGACY_KEYS.filter((k) => k in (value as Record<string, unknown>));
        if (found.length === 0) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linear"],
          message:
            `legacy linear keys [${found.join(", ")}] cannot be used together with the new ` +
            `\`linear.indicators\` map — they describe the same lifecycle and combining them is ` +
            `not possible. Migrate by moving each legacy key into linear.indicators (e.g. ` +
            `doneStatus: "Done" → indicators.setDone: {type: "status", value: "Done"}; ` +
            `statuses/labels → indicators.getTodo.filter; inProgressStatus → indicators.setInProgress; ` +
            `doneLabel → indicators.setDone {type: "label", ...}).`,
        });
      })
      .default({ postComments: true, updateEveryIterations: 10, indicators: {} }),
  })
  .default({
    concurrency: 1,
    pollIntervalSeconds: 60,
    maxIterationsPerTask: 0,
    maxCostUsdPerTask: 0,
    engine: "claude",
    model: "opus",
    linear: { postComments: true, updateEveryIterations: 10, indicators: {} },
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
