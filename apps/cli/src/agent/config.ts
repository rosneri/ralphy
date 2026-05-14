import { join } from "node:path";
import { z } from "zod";

const MarkerSchema = z.object({
  type: z.enum(["label", "status", "attachment"]),
  value: z.string().min(1),
});

const GetIndicatorSchema = z.object({
  filter: z.array(MarkerSchema).default([]),
});

const SetIndicatorSchema = z.union([z.array(MarkerSchema).min(1), MarkerSchema]);

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
    getReview: GetIndicatorSchema.optional(),
    getAutoMerge: GetIndicatorSchema.optional(),
    setInProgress: SetIndicatorSchema.optional(),
    setDone: SetIndicatorSchema.optional(),
    setError: SetIndicatorSchema.optional(),
    setConflicted: SetIndicatorSchema.optional(),
    clearConflicted: SetIndicatorSchema.optional(),
    clearReview: SetIndicatorSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // clearConflicted / clearReview only meaningfully remove labels —
    // Linear statuses are mutually exclusive (you set one to leave another),
    // so removing a status marker is nonsensical. Validate at parse time
    // so misconfigs surface immediately.
    for (const key of ["clearConflicted", "clearReview"] as const) {
      const clear = value[key];
      if (!clear) continue;
      const markers = Array.isArray(clear) ? clear : [clear];
      for (const m of markers) {
        if (m.type !== "label") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} markers must be label-typed (status removal is not supported)`,
          });
          break;
        }
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
    // Enable manual testing phase for each task (forwarded as --manual-test).
    enableManualTest: z.boolean().default(false),
    // When true, every task runs in a per-issue git worktree under
    // ~/.ralph/<project>/worktrees/<change-name> on a fresh `ralph/<change-name>` branch.
    useWorktree: z.boolean().default(false),
    cleanupWorktreeOnSuccess: z.boolean().default(false),
    setupScript: z.string().optional(),
    teardownScript: z.string().optional(),
    appendPrompt: z.string().optional(),
    createPrOnSuccess: z.boolean().default(false),
    prBaseBranch: z.string().default("main"),
    // When true, a new PR is opened against the head branch of a blocker's
    // open PR (resolved via Linear "blocked_by" relations + the blocker's
    // auto-attached GitHub PR) instead of `prBaseBranch`. Falls back to
    // `prBaseBranch` when the blocker has zero or multiple open PRs.
    // A `ralph:branch:<name>` label still wins over this resolution.
    stackPrsOnDependencies: z.boolean().default(false),
    autoMergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash"),
    fixCiOnFailure: z.boolean().default(false),
    maxCiFixAttempts: z.number().int().positive().default(5),
    ciPollIntervalSeconds: z.number().int().positive().default(30),
    ignoreCiChecks: z.array(z.string()).default([]),
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
        // When true, the agent scans comments on done issues for
        // `@ralphy` mentions (Linear comments + linked GitHub PR
        // comments) and queues the mentioning issue as a review run
        // with the mention text as the task. Idempotency: a mention is
        // considered unprocessed when its createdAt > the latest Ralph
        // "🔁 picked up" comment on the Linear issue.
        mentionTrigger: z.boolean().default(false),
        // The handle to scan for. Case-insensitive. Defaults to "@ralphy".
        mentionHandle: z.string().default("@ralphy"),
        // When true, the agent scans open, unmerged, unapproved tracked
        // PRs for unresolved review-thread comments. Newer-than-pickup
        // comments enqueue the issue as a code-review run with a digest
        // of every unresolved thread as the prepended task. If the PR
        // is stalled (Ralph is the last actor) for more than
        // `codeReviewStaleHours`, a one-shot reviewer ping is posted on
        // the GitHub PR with the reviewer's @-handle.
        codeReviewTrigger: z.boolean().default(false),
        // Hours of reviewer silence before Ralph nudges the reviewer
        // back to the PR. Only fires while `codeReviewTrigger` is on.
        codeReviewStaleHours: z.number().nonnegative().default(24),
        /**
         * Action map. Keys name the lifecycle event; values are typed
         * markers (label/status) to query or apply. See {@link IndicatorsSchema}.
         */
        indicators: IndicatorsSchema.default({}),
      })
      .strict()
      .default({
        postComments: true,
        updateEveryIterations: 10,
        mentionTrigger: false,
        mentionHandle: "@ralphy",
        codeReviewTrigger: false,
        codeReviewStaleHours: 24,
        indicators: {},
      }),
  })
  .default({
    concurrency: 1,
    pollIntervalSeconds: 60,
    maxIterationsPerTask: 0,
    maxCostUsdPerTask: 0,
    enableManualTest: false,
    engine: "claude",
    model: "opus",
    linear: {
      postComments: true,
      updateEveryIterations: 10,
      mentionTrigger: false,
      mentionHandle: "@ralphy",
      codeReviewTrigger: false,
      codeReviewStaleHours: 24,
      indicators: {},
    },
  });

export type RalphyConfig = z.infer<typeof RalphyConfigSchema>;

/** Strip `//` line comments from a JSONC string before parsing. */
function stripJsonComments(text: string): string {
  // Remove // line comments that are not inside strings.
  // This is a simple heuristic: it won't handle all edge cases (e.g. // inside
  // a string value), but is sufficient for ralphy.config.json where values
  // won't contain double-slash sequences.
  return text.replace(/\/\/[^\n]*/g, "");
}

export async function loadRalphyConfig(projectRoot: string): Promise<RalphyConfig> {
  const path = join(projectRoot, "ralphy.config.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return RalphyConfigSchema.parse({});
  }
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonComments(text));
  } catch (error) {
    throw new Error(
      `ralphy.config.json is not valid JSON.\n` +
        `  File: ${path}\n` +
        `  ${error instanceof Error ? error.message : String(error)}\n\n` +
        `Run \`ralph init\` to see the full default config with all available settings.`,
    );
  }
  const result = RalphyConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `ralphy.config.json has invalid settings:\n${issues}\n\n` +
        `Run \`ralph init\` to see the full default config with all available settings.`,
    );
  }
  return result.data;
}

/**
 * Default config template written when no `ralphy.config.json` exists.
 * Uses JSONC-style `//` comments so users can uncomment sections without
 * needing to look up the schema.
 *
 * The `linear.indicators` block is commented out because activating it will
 * query and mutate Linear labels/statuses. Uncomment only after you have
 * confirmed the label and status names match your Linear workspace.
 */
const DEFAULT_CONFIG_TEMPLATE = `{
  // How many tasks to run in parallel.
  "concurrency": 1,

  // Seconds between polls for new Linear issues (agent mode).
  "pollIntervalSeconds": 60,

  // Maximum iterations per task. 0 = unlimited.
  "maxIterationsPerTask": 0,

  // Maximum cost in USD per task. 0 = unlimited.
  "maxCostUsdPerTask": 0,

  // Maximum wall-clock minutes per task. 0 = unlimited.
  "maxRuntimeMinutesPerTask": 0,

  // Stop a task after this many consecutive identical failures.
  "maxConsecutiveFailuresPerTask": 5,

  // Seconds to wait between loop iterations (throttle).
  "iterationDelaySeconds": 0,

  // Log the raw engine stream to stdout.
  "logRawStream": false,

  // Pass --verbose to the ralph task sub-process.
  "taskVerbose": false,

  // Run each task in an isolated git worktree.
  "useWorktree": false,

  // Delete the worktree after a successful task.
  "cleanupWorktreeOnSuccess": false,

  // Shell script to run inside the worktree before the task starts.
  // "setupScript": "bun install",

  // Shell script to run inside the worktree after the task finishes.
  // "teardownScript": "bun run lint",

  // Extra text appended to every task prompt.
  // "appendPrompt": "Always run tests before finishing.",

  // Open a pull request after a task succeeds.
  "createPrOnSuccess": false,

  // Base branch for pull requests. Override per-issue by labelling the
  // Linear issue with "ralph:branch:<branch-name>".
  "prBaseBranch": "main",

  // When true, if the Linear issue is blocked by another issue whose
  // single open GitHub PR can be resolved (via Linear's auto-attachment),
  // open this PR against that blocker's head branch instead of prBaseBranch.
  // A "ralph:branch:<name>" label on the issue still wins over this.
  "stackPrsOnDependencies": false,

  // Merge strategy used when GitHub auto-merge is enabled (see getAutoMerge
  // indicator below). One of "squash", "merge", "rebase".
  "autoMergeStrategy": "squash",

  // Let the agent attempt to fix CI failures after a PR is created.
  "fixCiOnFailure": false,

  // Maximum number of CI-fix attempts per task.
  "maxCiFixAttempts": 5,

  // Seconds between CI status polls.
  "ciPollIntervalSeconds": 30,

  // CI check names to ignore when polling PR status (case-insensitive).
  // "ignoreCiChecks": ["Vercel", "codeql"],

  // Underlying engine: "claude" or "codex".
  "engine": "claude",

  // Model tier: "haiku", "sonnet", or "opus".
  "model": "opus",

  "linear": {
    // Linear team key to filter issues (e.g. "ENG"). Omit to match all teams.
    // "team": "ENG",

    // Linear user to filter issues. Can be an email address or user ID.
    // Omit to match issues regardless of assignee.
    // "assignee": "dev@example.com",

    // Post progress comments on the Linear issue while a task is running.
    "postComments": true,

    // Post a progress update every N iterations. 0 disables. Requires postComments.
    "updateEveryIterations": 10,

    // Watch done-issue Linear comments AND their linked GitHub PR comments
    // for "@ralphy" mentions. New mentions enqueue the issue as a review run
    // with the mention text as the prepended task.
    "mentionTrigger": false,
    // "mentionHandle": "@ralphy",

    // Watch open tracked PRs for unresolved review-thread comments and
    // prepend a code-review task. Pings the reviewer on the GitHub PR
    // when stalled for more than codeReviewStaleHours.
    "codeReviewTrigger": false,
    "codeReviewStaleHours": 24,

    // Indicators map Ralph lifecycle events to Linear labels/statuses.
    // WARNING: activating indicators will query AND mutate your Linear workspace.
    // Uncomment each entry after confirming the label/status names match your workspace.
    "indicators": {
      // Issues to pick up (any-of filter — Ralph will start working on these).
      // "getTodo": { "filter": [{ "type": "status", "value": "Todo" }] },

      // Issues already in flight (resume after restart).
      // "getInProgress": { "filter": [{ "type": "label", "value": "ralph:in-progress" }] },

      // Issues whose PR has a merge conflict (Ralph will attempt a re-fix run).
      // "getConflicted": { "filter": [{ "type": "label", "value": "ralph:conflict" }] },

      // Done issues with new review comments to address (Ralph will re-open
      // and prepend a task that ingests the non-Ralph comments).
      // "getReview": { "filter": [{ "type": "label", "value": "ralph:review" }] },

      // Issues opted in for auto-merge: when an issue matches, Ralph enables
      // GitHub auto-merge ("gh pr merge --auto --<autoMergeStrategy>") right
      // after opening the PR so the PR merges as soon as required checks pass.
      // "getAutoMerge": { "filter": [{ "type": "label", "value": "ralph:auto-merge" }] },

      // Applied when Ralph picks up an issue. Single marker or array of markers.
      // "setInProgress": { "type": "label", "value": "ralph:in-progress" },
      // "setInProgress": { "type": "attachment", "value": "In Progress" },
      // "setInProgress": [{ "type": "status", "value": "In Progress" }, { "type": "attachment", "value": "In Progress" }],

      // Applied on clean success.
      // "setDone": { "type": "status", "value": "In Review" },
      // "setDone": [{ "type": "status", "value": "In Review" }, { "type": "attachment", "value": "Done" }],

      // Applied when the task exits with an error (quarantine signal).
      // "setError": { "type": "label", "value": "ralph:error" },
      // "setError": [{ "type": "label", "value": "ralph:error" }, { "type": "attachment", "value": "Error" }],

      // Applied when a PR merge conflict is detected.
      // "setConflicted": { "type": "label", "value": "ralph:conflict" },

      // Label removed once the conflict is fixed (status removal is not supported here).
      // "clearConflicted": { "type": "label", "value": "ralph:conflict" },

      // Label removed when Ralph picks up a review-mode issue (status removal not supported).
      // "clearReview": { "type": "label", "value": "ralph:review" }
    }
  }
}
`;

export async function ensureRalphyConfig(projectRoot: string): Promise<string> {
  const path = join(projectRoot, "ralphy.config.json");
  const file = Bun.file(path);
  if (await file.exists()) return path;
  await Bun.write(path, DEFAULT_CONFIG_TEMPLATE);
  return path;
}
