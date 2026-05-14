/**
 * Wire protocol between the loop and pluggable agent adapters.
 *
 * This package is intentionally types-only (plus a small version constant).
 * It has no runtime dependencies so it can be shared by every adapter —
 * including future out-of-process subprocess adapters — without dragging in
 * heavier modules.
 */

/** Current protocol version. Bumped on any breaking change to AgentRequest / AgentEvent. */
export const PROTOCOL_VERSION = "1";

export type AgentRequest =
  | { type: "run"; prompt: string; model: string; cwd: string; resumeSessionId?: string }
  | { type: "cancel" };

export type AgentEvent =
  | { type: "hello"; protocolVersion: string }
  | { type: "session"; id: string }
  | { type: "text"; chunk: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: "rate_limited"; retryAfterMs?: number }
  | { type: "result"; exitCode: number };
