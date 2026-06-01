import { z } from "zod";

// --- Project layout ---

export interface ProjectLayout {
  /** The directory all relative paths derive from. */
  root: string;
  /** `<root>/.ralph/tasks` — parent of all per-change loop-state dirs. */
  statesDir: string;
  /** `<root>/openspec/changes` — parent of all per-change spec dirs. */
  tasksDir: string;
  /** `<root>/.ralph/agent-state.json` — orchestrator state file. */
  agentStateFile: string;
  /** `<root>/openspec/changes/<name>` — per-change spec dir. */
  changeDir(name: string): string;
  /** `<root>/.ralph/tasks/<name>` — per-change loop-state dir. */
  taskStateDir(name: string): string;
  /** `<root>/.ralph/tasks/<name>/.ralph-state.json` — per-change loop state file. */
  stateFile(name: string): string;
}

// --- Storage ---

export interface StorageProvider {
  /** Read a key. Returns null if it does not exist. */
  read(path: string): string | null;
  /** Write a key. Creates parent directories (or equivalent) as needed. */
  write(path: string, content: string): void;
  /** Delete a key. No-op if it does not exist. */
  remove(path: string): void;
  /** List child keys / entries under a prefix. Returns empty array if prefix does not exist. */
  list(prefix: string): string[];
}

// --- Type aliases ---

export type Engine = "claude" | "codex";
export type Mode = "task" | "list" | "status" | "init" | "agent" | "clean" | "debug";

// --- Iteration usage (per-run stats) ---

export const IterationUsageSchema = z.object({
  cost_usd: z.number(),
  duration_ms: z.number(),
  num_turns: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
});

export type IterationUsage = z.infer<typeof IterationUsageSchema>;

// --- Zod schemas ---

export const UsageSchema = z.object({
  total_cost_usd: z.number().default(0),
  total_duration_ms: z.number().default(0),
  total_turns: z.number().default(0),
  total_input_tokens: z.number().default(0),
  total_output_tokens: z.number().default(0),
  total_cache_read_input_tokens: z.number().default(0),
  total_cache_creation_input_tokens: z.number().default(0),
});

export const HistoryEntrySchema = z.object({
  timestamp: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  phase: z.string().optional(),
  iteration: z.number(),
  engine: z.string(),
  model: z.string(),
  result: z.string(),
  /** Ralphy version that ran this iteration (from `@ralphy/version`). Lets a
   *  mid-run restart/upgrade be traced to the exact iteration. */
  appVersion: z.string().optional(),
  usage: IterationUsageSchema.partial().optional(),
});

export const StateSchema = z.object({
  version: z.literal("2"),
  name: z.string(),
  prompt: z.string(),
  phase: z.string().default("specify"),
  phaseIteration: z.number().default(0),
  iteration: z.number().default(0),
  status: z.enum(["active", "blocked", "completed"]).default("active"),
  stopReason: z.string().optional(),
  createdAt: z.string(),
  lastModified: z.string(),
  engine: z.enum(["claude", "codex"]).default("claude"),
  model: z.string().default("opus"),
  manualTest: z.boolean().default(false),
  createPr: z.boolean().default(false),
  prDraft: z.boolean().default(false),
  validateOnComplete: z.boolean().default(false),
  usage: UsageSchema.default({}),
  history: z.array(HistoryEntrySchema).default([]),
  metadata: z.object({ branch: z.string().optional() }).default({}),
  /** Per-change Linear comment ids managed by comment-sync. Missing
   *  fields default to null so an older state file migrates silently. */
  linearComments: z
    .object({
      planCommentId: z.string().nullable().default(null),
      tasksCommentId: z.string().nullable().default(null),
      planPostedAt: z.string().nullable().default(null),
      /** sha256 of the tasks.md content the sticky comment was last
       *  rendered from. Lets postOrUpdateTasksComment hash-skip
       *  no-op updates, mirroring spec-attachments. */
      tasksCommentSha256: z.string().nullable().default(null),
    })
    .default({
      planCommentId: null,
      tasksCommentId: null,
      planPostedAt: null,
      tasksCommentSha256: null,
    }),
  /** Per-change Linear attachment ids + content hashes managed by
   *  spec-attachments. Without this slot in the schema, loop-side
   *  writeState() would strip the field every iteration, causing the
   *  syncer to re-upload (and re-create) proposal.md / design.md
   *  attachments forever — see lit-242 incident. */
  specAttachments: z
    .object({
      proposal: z
        .object({
          attachmentId: z.string().nullable().default(null),
          sha256: z.string().nullable().default(null),
        })
        .default({ attachmentId: null, sha256: null }),
      design: z
        .object({
          attachmentId: z.string().nullable().default(null),
          sha256: z.string().nullable().default(null),
        })
        .default({ attachmentId: null, sha256: null }),
      /** Peer slots for the rendered PDF mirror of proposal.md /
       *  design.md when `specAttachmentFormats` includes "pdf". The
       *  sha256 hashes the source MD (not the rendered bytes) so an
       *  identical input deterministically skips re-rendering. */
      proposalPdf: z
        .object({
          attachmentId: z.string().nullable().default(null),
          sha256: z.string().nullable().default(null),
        })
        .default({ attachmentId: null, sha256: null }),
      designPdf: z
        .object({
          attachmentId: z.string().nullable().default(null),
          sha256: z.string().nullable().default(null),
        })
        .default({ attachmentId: null, sha256: null }),
      /** One-shot marker set after the legacy proposal/proposalPdf
       *  attachments have been purged from Linear. Without this flag
       *  the syncer would issue a "Ralph proposal" lookup every sync. */
      legacyProposalPurged: z.boolean().default(false),
    })
    .default({
      proposal: { attachmentId: null, sha256: null },
      design: { attachmentId: null, sha256: null },
      proposalPdf: { attachmentId: null, sha256: null },
      designPdf: { attachmentId: null, sha256: null },
      legacyProposalPurged: false,
    }),
  /** Per-change confirmation-gate state used by the `awaiting-confirmation`
   *  phase. `askedAt` is set when Ralphy posts the "plan ready" comment;
   *  `lastReminderAt` tracks reminder cadence; `confirmedAt` is set when
   *  the approval indicator matches; `rounds` counts how many revise
   *  cycles the change has gone through. Missing slot ⇒ old persisted
   *  state still parses with all-null / zero defaults. */
  confirmation: z
    .object({
      askedAt: z.string().nullable().default(null),
      lastReminderAt: z.string().nullable().default(null),
      confirmedAt: z.string().nullable().default(null),
      rounds: z.number().default(0),
    })
    .default({
      askedAt: null,
      lastReminderAt: null,
      confirmedAt: null,
      rounds: 0,
    }),
  /** Per-change watermark for the GitHub code-review trigger. Stores the
   *  ISO timestamp of the newest reviewer comment that has already been
   *  enqueued so a subsequent poll with the same unresolved-thread list
   *  does not re-fire. Missing slot ⇒ old persisted state migrates with
   *  `lastConsumedCommentAt: null`. */
  review: z
    .object({
      lastConsumedCommentAt: z.string().nullable().default(null),
    })
    .default({ lastConsumedCommentAt: null }),
  /** Number of self-review rounds completed for this change. Incremented
   *  each time a reviewer pass finishes. Persists across iterations so the
   *  loop can enforce `maxReviewRounds`. Missing slot ⇒ 0. */
  reviewRounds: z.number().default(0),
});

// --- Inferred types ---

export type Usage = z.infer<typeof UsageSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type State = z.infer<typeof StateSchema>;

// --- Linear indicators ---
//
// Linear is the single source of truth for which issues Ralph has touched.
// Indicators are typed records of how Ralph queries / mutates Linear at
// each lifecycle transition. A `Marker` is one of four kinds: a Linear
// issue-label name (`label`), a Linear workflow-state name (`status`), a
// Ralphy attachment subtitle (`attachment`), or a Linear project name
// (`project`). `getX` indicators carry an any-of filter built from
// markers; `setX` indicators apply one or more markers.

export type Marker =
  | {
      type: "label";
      value: string;
      /** Optional Linear parent label group. When present, resolution looks
       *  the label up as `${group}:${value}` so nested labels (e.g.
       *  `Ralphy:error`) can be referenced by their bare child name. Only
       *  valid on the `label` variant. */
      group?: string;
    }
  | { type: "status"; value: string }
  /** Upserts a single "Ralphy" attachment on the issue; `value` becomes the
   *  attachment subtitle so each lifecycle transition updates the same entry. */
  | { type: "attachment"; value: string }
  /** Linear project name. On `getX` the issue's project name is matched
   *  case-insensitively; on `setX` the issue is reassigned to the
   *  project whose name matches `value`. */
  | { type: "project"; value: string }
  /** Case-insensitive substring match against the body of any non-Ralph
   *  comment on the issue. Read-only: rejected in `setX` slots at
   *  config-load time. */
  | { type: "comment"; value: string };

/** Any-of filter: an issue matches if ANY listed marker matches. */
export interface GetIndicator {
  filter: Marker[];
}

/** Single marker or array of markers to apply in one transition. */
export type SetIndicator = Marker | Marker[];

/**
 * Action-name → indicator map. All keys optional; missing keys mean
 * "Ralph does not perform that detection / mutation".
 */
export interface Indicators {
  /** Issues to pick up. */
  getTodo?: GetIndicator;
  /** Issues to resume after restart (already in flight). */
  getInProgress?: GetIndicator;
  /** Issues that have been completed / merged — included in the PR conflict+CI scan. */
  getDone?: GetIndicator;
  /** Issues currently under human review — included in the PR conflict+CI scan. */
  getReview?: GetIndicator;
  /** Issues opted in for auto-merge: when matched, the agent enables
   *  GitHub auto-merge on the PR immediately after creation. */
  getAutoMerge?: GetIndicator;
  /** Marker(s) applied when a worker spawns. */
  setInProgress?: SetIndicator;
  /** Marker(s) applied on clean success. */
  setDone?: SetIndicator;
  /** Marker(s) applied on non-zero exit (quarantine signal). */
  setError?: SetIndicator;
  /** Issues that the human has explicitly approved (confirmation gate). */
  getApproved?: GetIndicator;
  /** Label-only marker(s) removed when the approval is consumed. */
  clearApproved?: SetIndicator;
  /** Marker(s) applied when a ticket enters the confirmation gate. Applied
   *  once per gate-entry, just before the "📋 Ralphy plan ready" comment. */
  setAwaitingConfirmation?: SetIndicator;
  /** Label-only marker(s) removed when the confirmation gate releases the
   *  ticket (approval consumed, revise consumed, tasks empty, stub
   *  artifact, or gate manually cleared). */
  clearAwaitingConfirmation?: SetIndicator;
}

/** Convenience: extract the marker list applied by a SetIndicator. */
export function markersOf(set: SetIndicator): Marker[] {
  return Array.isArray(set) ? set : [set];
}

// --- Phase config ---

export const PhaseFrontmatterSchema = z.object({
  name: z.string(),
  order: z.number(),
  requires: z.array(z.string()).default([]),
  next: z.string().nullable().default(null),
  autoAdvance: z.enum(["allChecked"]).nullable().default(null),
  loopBack: z.string().nullable().default(null),
  terminal: z.boolean().default(false),
  context: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("file"),
          file: z.string(),
          label: z.string(),
        }),
        z.object({
          type: z.literal("currentSection"),
          label: z.string(),
        }),
      ]),
    )
    .default([]),
});

export type PhaseConfig = z.infer<typeof PhaseFrontmatterSchema> & { prompt: string };

// --- Feed event types ---

export type ToolInputSummary =
  | { kind: "file"; name: string }
  | { kind: "command"; text: string }
  | { kind: "search"; pattern: string; path?: string }
  | { kind: "url"; url: string }
  | { kind: "prompt"; text: string }
  | { kind: "edit" }
  | { kind: "write" }
  | { kind: "raw"; text: string };

/**
 * Structured output events emitted by engine stream formatters.
 * Both Claude and Codex formatters produce these same event types,
 * enabling shared rendering logic (Ink components or chalk strings).
 */
export type FeedEvent =
  | { type: "session"; model: string; sessionId: string; version?: string; toolCount?: number }
  | { type: "session-unknown"; sessionId: string }
  | { type: "agent"; description: string }
  | { type: "thinking"; preview?: string; totalLines?: number }
  | { type: "text"; text: string }
  | { type: "tool-start"; name: string; summary?: ToolInputSummary }
  | { type: "tool-end"; name?: string; summary?: string }
  | { type: "tool-result-preview"; lines: string[]; truncated?: number }
  | { type: "turn-start" }
  | { type: "turn-done"; inputTokens?: number; outputTokens?: number }
  | {
      type: "result";
      cost: number;
      timeMs: number;
      turns: number;
      inputTokens: number;
      outputTokens: number;
      cached: number;
    }
  | { type: "result-error"; message: string }
  | { type: "error"; message: string }
  | { type: "rate-limit"; message: string }
  | { type: "interrupted"; turns: number; tools: number }
  | { type: "raw"; text: string };
