import { describe, expect, test } from "bun:test";
import {
  StateSchema,
  UsageSchema,
  HistoryEntrySchema,
  markersOf,
  type Marker,
  type SetIndicator,
} from "../types";

describe("UsageSchema", () => {
  test("parses a full usage object", () => {
    const input = {
      total_cost_usd: 2.22,
      total_duration_ms: 550298,
      total_turns: 93,
      total_input_tokens: 161,
      total_output_tokens: 19808,
      total_cache_read_input_tokens: 2087788,
      total_cache_creation_input_tokens: 81925,
    };
    const result = UsageSchema.parse(input);
    expect(result).toEqual(input);
  });

  test("applies defaults for empty object", () => {
    const result = UsageSchema.parse({});
    expect(result.total_cost_usd).toBe(0);
    expect(result.total_turns).toBe(0);
  });
});

describe("HistoryEntrySchema", () => {
  test("parses a minimal history entry", () => {
    const input = {
      timestamp: "2026-03-03T16:10:35Z",
      iteration: 0,
      engine: "claude",
      model: "opus",
      result: "iteration complete",
    };
    const result = HistoryEntrySchema.parse(input);
    expect(result.timestamp).toBe("2026-03-03T16:10:35Z");
    expect(result.usage).toBeUndefined();
  });

  test("parses a history entry with usage", () => {
    const input = {
      timestamp: "2026-03-03T16:10:47Z",
      startedAt: "2026-03-03T16:06:04Z",
      endedAt: "2026-03-03T16:10:47Z",
      iteration: 1,
      engine: "claude",
      model: "opus",
      result: "success",
      usage: {
        cost_usd: 1.02,
        duration_ms: 282918,
        num_turns: 27,
      },
    };
    const result = HistoryEntrySchema.parse(input);
    expect(result.startedAt).toBe("2026-03-03T16:06:04Z");
    expect(result.usage?.cost_usd).toBe(1.02);
  });
});

describe("StateSchema", () => {
  test("parses a real state file", () => {
    const input = {
      version: "2" as const,
      name: "typescript",
      prompt: "Convert to typescript",
      iteration: 3,
      createdAt: "2026-03-03T16:06:04Z",
      lastModified: "2026-03-03T16:15:20Z",
      engine: "claude" as const,
      model: "opus",
      status: "active" as const,
      usage: {
        total_cost_usd: 2.22,
        total_duration_ms: 550298,
        total_turns: 93,
        total_input_tokens: 161,
        total_output_tokens: 19808,
        total_cache_read_input_tokens: 2087788,
        total_cache_creation_input_tokens: 81925,
      },
      history: [
        {
          timestamp: "2026-03-03T16:10:35Z",
          iteration: 0,
          engine: "claude",
          model: "opus",
          result: "iteration complete",
        },
      ],
      metadata: { branch: "main" },
    };
    const result = StateSchema.parse(input);
    expect(result.name).toBe("typescript");
    expect(result.history).toHaveLength(1);
    expect(result.metadata.branch).toBe("main");
  });

  test("applies defaults for minimal input", () => {
    const input = {
      version: "2" as const,
      name: "test-task",
      prompt: "do something",
      createdAt: "2026-01-01T00:00:00Z",
      lastModified: "2026-01-01T00:00:00Z",
    };
    const result = StateSchema.parse(input);
    expect(result.version).toBe("2");
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.status).toBe("active");
    expect(result.iteration).toBe(0);
    expect(result.usage.total_cost_usd).toBe(0);
    expect(result.history).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  test("preserves specAttachments across a parse round-trip (regression: lit-242 duplicate uploads)", () => {
    const input = {
      version: "2" as const,
      name: "rlf-x",
      prompt: "x",
      createdAt: "2026-01-01T00:00:00Z",
      lastModified: "2026-01-01T00:00:00Z",
      specAttachments: {
        proposal: { attachmentId: "att-p", sha256: "hp" },
        design: { attachmentId: "att-d", sha256: "hd" },
      },
    };
    const result = StateSchema.parse(input);
    expect(result.specAttachments.proposal.attachmentId).toBe("att-p");
    expect(result.specAttachments.design.attachmentId).toBe("att-d");
    expect(result.specAttachments.proposal.sha256).toBe("hp");
  });

  test("specAttachments defaults to null slots when omitted", () => {
    const result = StateSchema.parse({
      version: "2" as const,
      name: "x",
      prompt: "x",
      createdAt: "2026-01-01T00:00:00Z",
      lastModified: "2026-01-01T00:00:00Z",
    });
    expect(result.specAttachments.proposal.attachmentId).toBeNull();
    expect(result.specAttachments.design.attachmentId).toBeNull();
  });

  test("rejects missing required fields", () => {
    expect(() => StateSchema.parse({})).toThrow();
    expect(() => StateSchema.parse({ name: "x" })).toThrow();
  });
});

describe("markersOf", () => {
  test("wraps a single marker into a one-element array", () => {
    const m: Marker = { type: "label", value: "shipped" };
    expect(markersOf(m)).toEqual([m]);
  });

  test("returns the array as-is for a multi-marker SetIndicator", () => {
    const set: SetIndicator = [
      { type: "status", value: "Done" },
      { type: "label", value: "shipped" },
    ];
    expect(markersOf(set)).toEqual([
      { type: "status", value: "Done" },
      { type: "label", value: "shipped" },
    ]);
  });
});
