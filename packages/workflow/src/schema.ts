import { z } from "zod";

/**
 * WORKFLOW.md schema version, stamped into the file by `ralphy init`. A file
 * with no `version` is treated as legacy (0). Bump this when wizard fields are
 * added and register the change in the init app's MIGRATIONS list (a test keeps
 * the two in sync).
 */
export const CURRENT_WORKFLOW_VERSION = 5;

// Discriminated marker union: `group` is only valid on the `label` variant
// (resolves nested labels as `${group}:${value}` — see Marker type docs).
// Non-label variants are `.strict()` so that a stray `group` on a non-label
// marker raises a config error instead of being silently dropped.
const MarkerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("label"),
    value: z.string().min(1),
    group: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("status"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("attachment"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("project"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("comment"), value: z.string().min(1) }).strict(),
]);

const SET_INDICATOR_KEYS = [
  "setInProgress",
  "setDone",
  "setPrReady",
  "setError",
  "clearApproved",
] as const;

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
      getAutoMerge: GetIndicatorSchema.optional(),
      getApproved: GetIndicatorSchema.optional(),
      getConfirmGate: GetIndicatorSchema.optional(),
      getAutoApprove: GetIndicatorSchema.optional(),
      setInProgress: SetIndicatorSchema.optional(),
      setDone: SetIndicatorSchema.optional(),
      setPrReady: SetIndicatorSchema.optional(),
      setError: SetIndicatorSchema.optional(),
      setAwaitingConfirmation: SetIndicatorSchema.optional(),
      clearApproved: SetIndicatorSchema.optional(),
      clearAwaitingConfirmation: SetIndicatorSchema.optional(),
    })
    .superRefine((value, ctx) => {
      for (const key of ["clearApproved", "clearAwaitingConfirmation"] as const) {
        const clear = value[key];
        if (!clear) continue;
        const markers = Array.isArray(clear) ? clear : [clear];
        for (const m of markers) {
          if (m.type === "comment") continue;
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
      for (const key of SET_INDICATOR_KEYS) {
        const set = value[key];
        if (!set) continue;
        const markers = Array.isArray(set) ? set : [set];
        for (const m of markers) {
          if (m.type === "comment") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a 'comment' marker — comment markers are read-only and only valid in getX filters`,
            });
            break;
          }
        }
      }
    }),
);

/**
 * Fold a legacy `linear.assignee` string into the new global `linear.filter`
 * expression (RLF-206), then drop the `assignee` key so `.strict()` validation
 * does not reject it. A blank/`unassigned` legacy value maps to
 * `assignee = unassigned` to preserve the old "blank means unassigned" meaning;
 * any other value maps to `assignee = <value>`. An explicit `filter` always
 * wins — the legacy `assignee` is discarded.
 */
function foldLegacyAssignee(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  if (!("assignee" in obj)) return v;
  const { assignee, ...rest } = obj;
  if (rest["filter"] === undefined) {
    const raw = typeof assignee === "string" ? assignee.trim() : "";
    const value = raw === "" || raw.toLowerCase() === "unassigned" ? "unassigned" : raw;
    rest["filter"] = `assignee = ${value}`;
  }
  return rest;
}

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
  /** Schema version stamped by `ralphy init`. Absent / 0 means a legacy file
   *  written before versioning; `ralphy init` offers to migrate it. */
  version: z.number().int().nonnegative().default(0),
  project: ProjectSchema,
  /** Identity of the git repo this WORKFLOW.md is bound to, detected from the
   *  `origin` remote by `ralphy init`. Optional so remote-less and pre-v2 files
   *  still validate. */
  repo: z
    .object({
      remote: z.string().optional(),
      host: z.string().optional(),
      owner: z.string().optional(),
      name: z.string().optional(),
    })
    .strict()
    .optional(),
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
  logRawStream: z.boolean().default(true),
  taskVerbose: z.boolean().default(false),
  enableManualTest: z.boolean().default(false),
  useWorktree: z.boolean().default(false),
  cleanupWorktreeOnSuccess: z.boolean().default(false),
  setupScript: z.string().optional(),
  teardownScript: z.string().optional(),
  appendPrompt: z.string().optional(),
  createPrOnSuccess: z.boolean().default(false),
  prDraft: z.boolean().default(false),
  prBaseBranch: z.string().default("main"),
  stackPrsOnDependencies: z.boolean().default(false),
  autoMergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash"),
  manualMergeWhenAutoMergeDisabled: z.boolean().default(true),
  /** When a branch's entire history touched only meta files (openspec, tasks.md,
   *  etc.), the requested work is already on the base branch or was a no-op.
   *  When true (default), finalize the ticket as done with a "no changes needed"
   *  comment instead of respawning a doomed reapply loop and quarantining it. */
  finalizeNoOpAsDone: z.boolean().default(true),
  fixCiOnFailure: z.boolean().default(false),
  maxCiFixAttempts: z.number().int().positive().default(5),
  ciPollIntervalSeconds: z.number().int().positive().default(30),
  ignoreCiChecks: z.array(z.string()).default([]),
  engine: z.enum(["claude", "codex"]).default("claude"),
  model: z.enum(["haiku", "sonnet", "opus"]).default("opus"),
  linear: z
    .preprocess(
      foldLegacyAssignee,
      z
        .object({
          team: z.string().optional(),
          /** Global Linear ticket filter expression (e.g. `assignee = me`). RLF-206:
           *  replaces the former `assignee` string. Parsed by `parseLinearFilter`. */
          filter: z.string().default("assignee = me"),
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
          /** Post-seal behavior for the design attachment (once a PR exists).
           *  "replace" (default) overwrites the single canonical `Ralph design`
           *  attachment in place — no `#N` accumulation. "append" publishes
           *  each design change as a new `Ralph design #N (revision)`
           *  attachment, preserving an audit trail. Config-file-only: not
           *  offered by the init wizard. */
          specAttachmentRevisions: z.enum(["append", "replace"]).default("replace"),
          confirmationMode: z
            .object({
              enabled: z.boolean().default(false),
              timeoutHours: z.number().positive().default(48),
              maxConfirmationRounds: z.number().int().positive().default(3),
            })
            .strict()
            .default({
              enabled: false,
              timeoutHours: 48,
              maxConfirmationRounds: 3,
            }),
          indicators: IndicatorsSchema.default({}),
        })
        .strict(),
    )
    .default({
      filter: "assignee = me",
      postComments: true,
      updateEveryIterations: 10,
      mentionTrigger: true,
      mentionHandle: "@ralphy",
      codeReviewTrigger: true,
      codeReviewStaleHours: 24,
      syncTasksToComment: true,
      syncSpecsAsAttachments: true,
      specAttachmentFormats: ["md"],
      specAttachmentRevisions: "replace",
      confirmationMode: {
        enabled: false,
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
  /** RLF-173: scheduler-tier watcher that auto-recovers In-Review PRs
   *  whose merge state goes red. Bails to `ralph:error` after
   *  `maxRecoveryAttempts` failed recovery attempts so a stubbornly
   *  broken PR can't bounce forever. */
  prTracker: z
    .object({
      enabled: z.boolean().default(true),
      maxRecoveryAttempts: z.number().int().positive().default(3),
      advanceMergedToDone: z.boolean().default(false),
    })
    .strict()
    .default({
      enabled: true,
      maxRecoveryAttempts: 3,
      advanceMergedToDone: false,
    }),
  metaPrompt: z
    .object({
      /** Set to false to disable the task-level meta-prompt layer for all phases. */
      enabled: z.boolean().default(true),
      /**
       * Effort tier for the meta-prompt's per-ticket guidance. `auto` runs the
       * heuristic classifier; a concrete tier pins every ticket to that tier.
       */
      effort: z.enum(["auto", "light", "standard", "heavy"]).default("auto"),
    })
    .strict()
    .default({ enabled: true, effort: "auto" }),
  openspec: z
    .object({
      reviewPhase: z
        .object({
          enabled: z.boolean().default(false),
          maxRounds: z.number().int().nonnegative().default(1),
          reviewerModel: z.string().optional(),
          reviewerContextStrategy: z.enum(["fresh", "warm"]).default("fresh"),
        })
        .strict()
        .default({
          enabled: false,
          maxRounds: 1,
          reviewerContextStrategy: "fresh",
        }),
    })
    .strict()
    .default({
      reviewPhase: {
        enabled: false,
        maxRounds: 1,
        reviewerContextStrategy: "fresh",
      },
    }),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
