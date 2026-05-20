import { z } from "zod";

const MarkerSchema = z.object({
  type: z.enum(["label", "status", "attachment", "project"]),
  value: z.string().min(1),
});

const GetIndicatorSchema = z.object({
  filter: z.array(MarkerSchema).default([]),
});

const SetIndicatorSchema = z.union([z.array(MarkerSchema).min(1), MarkerSchema]);

const IndicatorsSchema = z.preprocess(
  // Accept `indicators:` (bare) — YAML parses that as null — as an empty
  // map. Lets the default WORKFLOW.md leave the key open for inline edits.
  (v) => (v == null ? {} : v),
  z
    .object({
      getTodo: GetIndicatorSchema.optional(),
      getInProgress: GetIndicatorSchema.optional(),
      getConflicted: GetIndicatorSchema.optional(),
      getReview: GetIndicatorSchema.optional(),
      getAutoMerge: GetIndicatorSchema.optional(),
      getApproved: GetIndicatorSchema.optional(),
      setInProgress: SetIndicatorSchema.optional(),
      setDone: SetIndicatorSchema.optional(),
      setError: SetIndicatorSchema.optional(),
      setConflicted: SetIndicatorSchema.optional(),
      clearConflicted: SetIndicatorSchema.optional(),
      clearReview: SetIndicatorSchema.optional(),
      clearApproved: SetIndicatorSchema.optional(),
    })
    .superRefine((value, ctx) => {
      for (const key of ["clearConflicted", "clearReview", "clearApproved"] as const) {
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
    }),
);

const ProjectSchema = z
  .object({
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
  })
  .strict()
  .default({});

const CommandsSchema = z
  .object({
    test: z.string().optional(),
    lint: z.string().optional(),
    build: z.string().optional(),
    typecheck: z.string().optional(),
  })
  .catchall(z.string())
  .default({});

/**
 * Default meta-only globs used by the pre-PR "substantive diff" guard.
 * If every file changed against the base branch matches one of these,
 * the loop refuses to open the PR (the actual implementation was lost)
 * and re-runs the worker with a fix task instead.
 */
export const DEFAULT_META_ONLY_FILES = [
  "openspec/**",
  ".ralph/**",
  "**/agent-tasks.md",
  "**/tasks.md",
  "**/MANUAL_TESTING*.md",
];

const BoundariesSchema = z
  .object({
    never_touch: z.array(z.string()).default([]),
    meta_only_files: z.array(z.string()).default(DEFAULT_META_ONLY_FILES),
  })
  .strict()
  .default({ never_touch: [], meta_only_files: DEFAULT_META_ONLY_FILES });

export const WorkflowConfigSchema = z.object({
  project: ProjectSchema,
  commands: CommandsSchema,
  rules: z.array(z.string()).default([]),
  boundaries: BoundariesSchema,
  concurrency: z.number().int().positive().default(1),
  pollIntervalSeconds: z.number().int().positive().default(60),
  maxIterationsPerTask: z.number().int().nonnegative().default(0),
  maxCostUsdPerTask: z.number().nonnegative().default(0),
  maxRuntimeMinutesPerTask: z.number().nonnegative().default(0),
  maxConsecutiveFailuresPerTask: z.number().int().nonnegative().default(5),
  iterationDelaySeconds: z.number().int().nonnegative().default(0),
  logRawStream: z.boolean().default(false),
  taskVerbose: z.boolean().default(false),
  enableManualTest: z.boolean().default(false),
  useWorktree: z.boolean().default(false),
  cleanupWorktreeOnSuccess: z.boolean().default(false),
  setupScript: z.string().optional(),
  teardownScript: z.string().optional(),
  appendPrompt: z.string().optional(),
  createPrOnSuccess: z.boolean().default(false),
  prBaseBranch: z.string().default("main"),
  stackPrsOnDependencies: z.boolean().default(false),
  autoMergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash"),
  manualMergeWhenAutoMergeDisabled: z.boolean().default(true),
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
      postComments: z.boolean().default(true),
      updateEveryIterations: z.number().int().nonnegative().default(10),
      mentionTrigger: z.boolean().default(true),
      mentionHandle: z.string().default("@ralphy"),
      codeReviewTrigger: z.boolean().default(true),
      codeReviewStaleHours: z.number().nonnegative().default(24),
      syncTasksToComment: z.boolean().default(true),
      syncSpecsAsAttachments: z.boolean().default(true),
      /** Which rendered formats to upload for proposal.md / design.md.
       *  "md" mirrors the source file as-is. "pdf" additionally
       *  renders a pure-JS PDF (pdfkit) and uploads it as a peer
       *  attachment. Default keeps the prior behaviour ("md" only). */
      specAttachmentFormats: z
        .array(z.enum(["md", "pdf"]))
        .nonempty()
        .default(["md"]),
      confirmationMode: z
        .object({
          enabled: z.boolean().default(false),
          optOutLabel: z.string().default("ralph:auto-approve"),
          timeoutHours: z.number().positive().default(48),
          maxConfirmationRounds: z.number().int().positive().default(3),
        })
        .strict()
        .default({
          enabled: false,
          optOutLabel: "ralph:auto-approve",
          timeoutHours: 48,
          maxConfirmationRounds: 3,
        }),
      indicators: IndicatorsSchema.default({}),
    })
    .strict()
    .default({
      postComments: true,
      updateEveryIterations: 10,
      mentionTrigger: true,
      mentionHandle: "@ralphy",
      codeReviewTrigger: true,
      codeReviewStaleHours: 24,
      syncTasksToComment: true,
      syncSpecsAsAttachments: true,
      specAttachmentFormats: ["md"],
      confirmationMode: {
        enabled: false,
        optOutLabel: "ralph:auto-approve",
        timeoutHours: 48,
        maxConfirmationRounds: 3,
      },
      indicators: {},
    }),
  github: z
    .object({
      base_branch: z.string().optional(),
      auto_merge_strategy: z.enum(["squash", "merge", "rebase"]).optional(),
    })
    .strict()
    .optional(),
  agent: z
    .object({
      engine: z.enum(["claude", "codex"]).optional(),
      model: z.enum(["haiku", "sonnet", "opus"]).optional(),
      concurrency: z.number().int().positive().optional(),
      max_iterations_per_task: z.number().int().nonnegative().optional(),
      max_consecutive_failures: z.number().int().nonnegative().optional(),
    })
    .strict()
    .optional(),
  worktree: z
    .object({
      enabled: z.boolean().optional(),
      cleanup_on_success: z.boolean().optional(),
      setup_script: z.string().optional(),
    })
    .strict()
    .optional(),
  ci: z
    .object({
      fix_on_failure: z.boolean().optional(),
      max_attempts: z.number().int().positive().optional(),
      poll_interval_seconds: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
  preExistingErrorCheck: z
    .object({
      enabled: z.boolean().default(false),
      commands: z.array(z.string()).default([]),
      baseBranch: z.string().default("main"),
      label: z.string().default("ralph:pre-existing-error"),
      outputCharLimit: z.number().int().positive().default(4000),
    })
    .strict()
    .default({
      enabled: false,
      commands: [],
      baseBranch: "main",
      label: "ralph:pre-existing-error",
      outputCharLimit: 4000,
    }),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
