import { z } from "zod";
import { LinearFilterSchema, MarkerSchema } from "./linear-filter";

/**
 * WORKFLOW.md schema version, stamped into the file by `ralphy init`. A file
 * with no `version` is treated as legacy (0). Bump this when wizard fields are
 * added and register the change in the init app's MIGRATIONS list (a test keeps
 * the two in sync).
 */
export const CURRENT_WORKFLOW_VERSION = 8;

/** Reasoning-effort levels accepted by `claude --effort`. Enum order is
 *  display order (cheapest first); there is deliberately no default — an unset
 *  effort omits the flag and lets the engine pick its own default. */
const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

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

/** Like {@link SetIndicatorSchema} but allows an empty array. A `clear*`
 *  indicator with nothing to remove is valid — e.g. comment-based approval,
 *  where the gate is satisfied by a comment and there is no marker to clear. */
const ClearIndicatorSchema = z.union([z.array(MarkerSchema), MarkerSchema]);

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
      setInProgress: SetIndicatorSchema.optional(),
      setDone: SetIndicatorSchema.optional(),
      setPrReady: SetIndicatorSchema.optional(),
      setError: SetIndicatorSchema.optional(),
      setAwaitingConfirmation: SetIndicatorSchema.optional(),
      clearApproved: ClearIndicatorSchema.optional(),
      clearAwaitingConfirmation: ClearIndicatorSchema.optional(),
    })
    .superRefine((value, ctx) => {
      for (const key of ["clearApproved", "clearAwaitingConfirmation"] as const) {
        const clear = value[key];
        if (!clear) continue;
        const markers = Array.isArray(clear) ? clear : [clear];
        for (const m of markers) {
          if ("negate" in m && m.negate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a negated marker — negation is only meaningful in getX filters`,
            });
            break;
          }
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
          if ("negate" in m && m.negate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a negated marker — negation is only meaningful in getX filters`,
            });
            break;
          }
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
 * marker list, then drop the `assignee` key so `.strict()` validation does not
 * reject it. A blank/`unassigned` legacy value maps to an `unassigned` assignee
 * clause to preserve the old "blank means unassigned" meaning; any other value
 * becomes the clause value verbatim. An explicit `filter` always wins — the
 * legacy `assignee` is discarded.
 */
function foldLegacyAssignee(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  if (!("assignee" in obj)) return v;
  const { assignee, ...rest } = obj;
  if (rest["filter"] === undefined) {
    const raw = typeof assignee === "string" ? assignee.trim() : "";
    const value = raw === "" || raw.toLowerCase() === "unassigned" ? "unassigned" : raw;
    rest["filter"] = [{ type: "assignee", value }];
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

/** Default for the in-loop structural gate (`commands.structure`). Single-sourced
 *  so the field default and the CommandsSchema container default stay in lockstep. */
export const DEFAULT_STRUCTURE_COMMAND = "bun run check:structure";

const CommandsSchema = z
  .object({
    test: z.string().optional(),
    lint: z.string().optional(),
    build: z.string().optional(),
    typecheck: z.string().optional(),
    /** In-loop structural gate run alongside test/lint/typecheck in the
     *  validate-only phase. Defaults on (`bun run check:structure`) so the
     *  Ralph loop enforces the project's own structure guardrails each
     *  iteration; set it to "" in WORKFLOW.md to opt a project out. */
    structure: z.string().default(DEFAULT_STRUCTURE_COMMAND),
  })
  .catchall(z.string())
  .default({ structure: DEFAULT_STRUCTURE_COMMAND });

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
  /** GitHub labels attached to every pull request Ralph opens. Applied
   *  best-effort after the PR exists (`gh pr edit --add-label`) so a missing
   *  or mistyped label never blocks PR creation. Empty (the default) attaches
   *  no labels. Mirrors onto `github.pr_labels`. Offered by the init wizard's
   *  customized walkthrough when PR-creation is enabled (not in quick /
   *  permissive mode). */
  prLabels: z.array(z.string()).default([]),
  stackPrsOnDependencies: z.boolean().default(false),
  autoMergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash"),
  manualMergeWhenAutoMergeDisabled: z.boolean().default(true),
  /** When a branch's entire history touched only meta files (openspec, tasks.md,
   *  etc.), the requested work is already on the base branch or was a no-op.
   *  When true (default), finalize the ticket as done with a "no changes needed"
   *  comment instead of respawning a doomed reapply loop and quarantining it. */
  finalizeNoOpAsDone: z.boolean().default(true),
  engine: z.enum(["claude", "codex"]).default("claude"),
  // Enum order is display order: the wizard and CLI derive their option lists
  // from this schema (see schema-introspect.ts). `fable` is the Fable line;
  // the Claude tiers follow most-capable-first. Default stays `opus`.
  model: z.enum(["fable", "opus", "sonnet", "haiku"]).default("opus"),
  /** Reasoning-effort level passed to the engine (`claude --effort`). Unset
   *  means the engine's own default. Claude engine only — codex ignores it. */
  effort: EffortSchema.optional(),
  /** Model / reasoning effort for the planning OpenSpec phases (proposal,
   *  design, tasks). Unset falls back to the top-level `model` / `effort`. The
   *  implement phase always uses the top-level model. Free string like
   *  `reviewerModel`, so full model ids are allowed in addition to tier aliases. */
  planModel: z.string().optional(),
  planEffort: EffortSchema.optional(),
  /** Which issue tracker drives the loop. Defaults to `linear`, so a file with
   *  no `tracker` block behaves exactly as before. `github` selects the GitHub
   *  Issues provider (built on the `gh` CLI; see `github.issues`). */
  tracker: z
    .object({
      kind: z.enum(["linear", "github"]).default("linear"),
    })
    .strict()
    .default({ kind: "linear" }),
  linear: z
    .preprocess(
      foldLegacyAssignee,
      z
        .object({
          team: z.string().optional(),
          /** Global Linear ticket filter: a marker list (label + assignee) ANDed
           *  into every Linear query. Resolved by `resolveLinearFilter`. */
          filter: LinearFilterSchema,
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
      filter: [{ type: "assignee", value: "me" }],
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
      /** Labels attached to every PR Ralph opens; aliased onto the flat
       *  `prLabels`. Applies regardless of `tracker.kind`. */
      pr_labels: z.array(z.string()).optional(),
      /** GitHub Issues provider settings, consulted only when
       *  `tracker.kind === "github"`. Optional so a github block carrying only
       *  `base_branch`/`auto_merge_strategy` still validates. */
      issues: z
        .object({
          /** `owner/name`; defaults to the repo detected from `origin`. */
          repo: z.string().optional(),
          /** Label that marks an issue as a pick-up candidate (the todo filter). */
          label: z.string().optional(),
          /** Filter to issues assigned to this login (e.g. a username or `@me`). */
          assignee: z.string().optional(),
          /** Labels applied as the issue moves through the loop lifecycle. */
          statusLabels: z
            .object({
              inProgress: z.string().default("ralph:in-progress"),
              done: z.string().default("ralph:done"),
              error: z.string().default("ralph:error"),
            })
            .strict()
            .default({
              inProgress: "ralph:in-progress",
              done: "ralph:done",
              error: "ralph:error",
            }),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  agent: z
    .object({
      engine: z.enum(["claude", "codex"]).optional(),
      model: z.enum(["fable", "opus", "sonnet", "haiku"]).optional(),
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
  /** RLF-173 / RLF-97: unified PR-recovery watcher. After a worker opens a PR
   *  the ticket rests in-review; the scheduler-tier watcher polls the in-review
   *  PRs it tracks and (a) advances a ticket to done once its PR is mergeable
   *  (CI green + no conflicts), and (b) auto-recovers any whose merge state goes
   *  red — merge conflicts when `fixConflicts` is on, failing CI when `fixCi` is
   *  on. It re-queues a fix worker each detection and bails to `ralph:error`
   *  after `maxRecoverySessions` failed sessions so a stubbornly broken PR can't
   *  bounce forever. The worker itself performs NO in-process recovery; all
   *  recovery — and the move to done — is the watcher's job. `enabled: false`
   *  turns the watcher off everywhere; the worker then marks the ticket done
   *  immediately on PR open (no deferral, no recovery). */
  prRecovery: z
    .object({
      /** Master switch. When false, the watcher does no recovery and never
       *  advances tickets to done — the worker marks done on PR open instead. */
      enabled: z.boolean().default(true),
      /** Recover failing CI by re-running the agent. Off leaves CI-red PRs for a
       *  human (the watcher still advances mergeable PRs to done). */
      fixCi: z.boolean().default(true),
      /** Recover merge conflicts by re-running the agent. Off leaves conflicting
       *  PRs for a human (the watcher still advances mergeable PRs to done). */
      fixConflicts: z.boolean().default(true),
      /** Give up auto-recovering a red PR after this many re-queue sessions,
       *  then apply `setError` for a human. */
      maxRecoverySessions: z.number().int().positive().default(3),
      /** Model / effort for CI-fix workers. Unset falls back to the top-level
       *  `model` / `effort`. Free string like `reviewerModel`, so full model
       *  ids are allowed in addition to the tier aliases. */
      ciFixModel: z.string().optional(),
      ciFixEffort: EffortSchema.optional(),
      /** Model / effort for merge-conflict-fix workers. Same fallback rules. */
      conflictFixModel: z.string().optional(),
      conflictFixEffort: EffortSchema.optional(),
      /** CI check names the watcher ignores when judging a PR green (e.g.
       *  known-flaky jobs). */
      ignoreChecks: z.array(z.string()).default([]),
    })
    .strict()
    .default({
      enabled: true,
      fixCi: true,
      fixConflicts: true,
      maxRecoverySessions: 3,
      ignoreChecks: [],
    }),
  /**
   * Tokenade (https://tokenade.net) — a local-first CLI that compacts what a
   * coding agent sends to the model (command output, MCP manifests, file reads).
   * Tokenade does the compaction through hooks it installs into the agent's own
   * config, so Ralphy never performs the compaction itself. Enabling this block
   * makes Ralphy (a) verify in preflight that the `tokenade` CLI is installed
   * and licensed before a run burns tokens unoptimized, and (b) warm tokenade's
   * code index in every freshly provisioned worktree so the first iterations do
   * not pay cold-index read costs.
   *
   * Off by default. `enabled: false` means Ralphy neither checks nor warms —
   * it does NOT turn off a tokenade the user installed globally, because the
   * CLI exposes no per-process kill switch. A globally installed tokenade keeps
   * optimizing Ralphy's engine spawns either way.
   */
  tokenade: z
    .object({
      /** Master switch for Ralphy's tokenade awareness (preflight + index warm). */
      enabled: z.boolean().default(false),
      /** Treat a missing or unlicensed tokenade as a fatal preflight failure.
       *  Off by default, so an enabled-but-absent tokenade degrades to a
       *  warning and the run proceeds unoptimized rather than refusing to
       *  start. */
      required: z.boolean().default(false),
      /** Run `tokenade index` when a worker's worktree is first provisioned.
       *  A fresh worktree is a fresh directory with a cold index. Best-effort:
       *  a failure is logged and never blocks the worker. */
      indexWorktrees: z.boolean().default(true),
      /** `TOKENADE_READ_MODE` for spawned engine processes — how aggressively
       *  tokenade folds file reads. Unset leaves tokenade's own default. */
      readMode: z.enum(["aggressive", "task", "reference", "entropy"]).optional(),
    })
    .strict()
    .default({ enabled: false, required: false, indexWorktrees: true }),
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
          /** Effort for the review pass. Unset falls back to the top-level
           *  `effort` (then the engine default). */
          reviewerEffort: EffortSchema.optional(),
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
