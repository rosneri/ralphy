import { z } from "zod";

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
export type Mode = "task" | "list" | "status" | "init" | "agent";

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
  usage: UsageSchema.default({}),
  history: z.array(HistoryEntrySchema).default([]),
  metadata: z.object({ branch: z.string().optional() }).default({}),
});

// --- Inferred types ---

export type Usage = z.infer<typeof UsageSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type State = z.infer<typeof StateSchema>;

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
