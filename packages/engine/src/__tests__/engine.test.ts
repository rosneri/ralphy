import { describe, expect, test } from "bun:test";
import type { FeedEvent } from "../feed-events";
import type { IterationUsage } from "@ralphy/types";
import { handleEngineFailure, runEngine, consumeEngineEvents } from "../engine";
import { createScriptedAdapter } from "../adapters/scripted";

// Engine-level tests run against a scripted adapter that emits a canned
// FeedEvent sequence. No subprocess is spawned; tests do not touch
// `Bun.spawn` or `Bun.spawnSync`. Adapter-internal (spawn-based) behavior
// is covered in engine-spawn.test.ts.

// ─── handleEngineFailure ─────────────────────────────────────────

describe("handleEngineFailure", () => {
  test("exit code 42 returns rate limit and shouldStop=true", () => {
    const r = handleEngineFailure(42);
    expect(r.message).toContain("Rate limited");
    expect(r.shouldStop).toBe(true);
  });

  test("exit code 130 returns interrupted and shouldStop=false", () => {
    const r = handleEngineFailure(130);
    expect(r.message).toContain("Interrupted");
    expect(r.shouldStop).toBe(false);
  });

  test("exit code 137 returns killed and shouldStop=false", () => {
    const r = handleEngineFailure(137);
    expect(r.message).toContain("Killed");
    expect(r.shouldStop).toBe(false);
  });

  test("exit code 1 returns general error", () => {
    const r = handleEngineFailure(1);
    expect(r.message).toContain("Failed (exit 1)");
    expect(r.shouldStop).toBe(false);
  });

  test("unknown exit code returns generic message", () => {
    const r = handleEngineFailure(99);
    expect(r.message).toContain("Failed (exit 99)");
    expect(r.shouldStop).toBe(false);
  });
});

// ─── Scripted adapter fixtures ───────────────────────────────────

const sampleUsage: IterationUsage = {
  cost_usd: 0.01,
  duration_ms: 100,
  num_turns: 1,
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 0,
};

function sessionEvent(): FeedEvent {
  return { type: "session", model: "claude-test", sessionId: "abcd1234" };
}
function textEvent(text: string): FeedEvent {
  return { type: "text", text };
}
function resultEvent(usage: IterationUsage = sampleUsage): FeedEvent {
  return {
    type: "result",
    cost: usage.cost_usd,
    timeMs: usage.duration_ms,
    turns: usage.num_turns,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cached: usage.cache_read_input_tokens,
  };
}

// ─── runEngine + scripted adapter ────────────────────────────────

describe("runEngine (scripted adapter)", () => {
  test("captures full session id from adapter", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), resultEvent()],
      sessionId: "full-session-id-abcd1234567890",
      usage: sampleUsage,
    });

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: () => {},
    });

    expect(result.sessionId).toBe("full-session-id-abcd1234567890");
  });

  test("aggregates usage from adapter", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), textEvent("hi"), resultEvent()],
      usage: sampleUsage,
    });

    const events: FeedEvent[] = [];
    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: (e) => events.push(e),
    });

    expect(result.usage).toEqual(sampleUsage);
    expect(result.exitCode).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["session", "text", "result"]);
  });

  test("detects rate-limit text in feed events", async () => {
    const adapter = createScriptedAdapter({
      events: [
        sessionEvent(),
        textEvent("You've hit your limit, please try again later."),
        resultEvent(),
      ],
      usage: sampleUsage,
    });

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: () => {},
    });

    expect(result.rateLimited).toBe(true);
  });

  test("does not flag rate-limit on unrelated text", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), textEvent("All good."), resultEvent()],
      usage: sampleUsage,
    });

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: () => {},
    });

    expect(result.rateLimited).toBe(false);
  });

  test("aborting via signal kills the adapter and normalizes exit 143", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), textEvent("streaming..."), textEvent("more...")],
      exitCode: 0,
      killedExitCode: 143,
      eventDelayMs: 10,
    });

    const controller = new AbortController();
    const promise = runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      signal: controller.signal,
      onFeedEvent: () => {},
    });

    // Let the first event flush, then abort mid-stream.
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();

    const result = await promise;
    expect(adapter.wasKilled()).toBe(true);
    expect(result.exitCode).toBe(0); // 143 normalized because intentional kill
  });

  test("aborting before run starts kills and exits cleanly", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), resultEvent()],
      killedExitCode: 137,
      usage: sampleUsage,
    });
    const controller = new AbortController();
    controller.abort();

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      signal: controller.signal,
      onFeedEvent: () => {},
    });

    expect(adapter.wasKilled()).toBe(true);
    expect(result.exitCode).toBe(0); // 137 normalized because intentional kill
  });

  test("non-zero exit (no kill) is preserved", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent()], // no result event, process exits 1
      exitCode: 1,
    });

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.usage).toBeNull();
  });

  test("unintentional SIGTERM (143) is preserved", async () => {
    // Adapter is never killed by us; exit code 143 should not be normalized.
    const adapter = createScriptedAdapter({
      events: [sessionEvent()],
      exitCode: 143,
    });

    const result = await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: () => {},
    });

    expect(result.exitCode).toBe(143);
  });

  test("claude engine kills adapter at first result and stops consuming", async () => {
    const adapter = createScriptedAdapter({
      events: [
        sessionEvent(),
        textEvent("hello"),
        resultEvent(),
        // events past the first result should not be emitted
        textEvent("should-not-appear"),
      ],
      usage: sampleUsage,
    });

    const seen: FeedEvent[] = [];
    await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: (e) => seen.push(e),
    });

    expect(adapter.wasKilled()).toBe(true);
    expect(seen.map((e) => e.type)).toEqual(["session", "text", "result"]);
    expect(seen.find((e) => e.type === "text" && e.text === "should-not-appear")).toBeUndefined();
  });

  test("result-error also stops claude stream", async () => {
    const adapter = createScriptedAdapter({
      events: [
        sessionEvent(),
        { type: "result-error", message: "boom" } as FeedEvent,
        textEvent("should-not-appear"),
      ],
    });

    const seen: FeedEvent[] = [];
    await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: (e) => seen.push(e),
    });

    expect(seen.find((e) => e.type === "text")).toBeUndefined();
  });

  test("codex engine consumes the full stream (no result-based kill)", async () => {
    const adapter = createScriptedAdapter({
      events: [
        { type: "session", model: "codex-test", sessionId: "codex123" } as FeedEvent,
        { type: "turn-start" } as FeedEvent,
        textEvent("hello codex"),
        { type: "turn-done", inputTokens: 50, outputTokens: 30 } as FeedEvent,
      ],
    });

    const seen: FeedEvent[] = [];
    const result = await runEngine({
      engine: "codex",
      model: "codex-test",
      prompt: "ignored",
      adapter,
      onFeedEvent: (e) => seen.push(e),
    });

    expect(seen.map((e) => e.type)).toEqual(["session", "turn-start", "text", "turn-done"]);
    expect(adapter.wasKilled()).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeNull();
  });

  test("falls back to renderFeedEvent string output when no onFeedEvent given", async () => {
    const adapter = createScriptedAdapter({
      events: [sessionEvent(), resultEvent()],
      usage: sampleUsage,
    });

    const lines: string[] = [];
    await runEngine({
      engine: "claude",
      model: "claude-test",
      prompt: "ignored",
      adapter,
      onOutput: (line) => lines.push(line),
    });

    expect(lines.length).toBeGreaterThan(0);
  });
});

// ─── consumeEngineEvents direct unit tests ───────────────────────

describe("consumeEngineEvents", () => {
  test("returns null usage and sessionId when adapter provides none", async () => {
    const adapter = createScriptedAdapter({ events: [textEvent("hi")] });

    const result = await consumeEngineEvents(adapter, {
      engine: "codex",
      onFeedEvent: () => {},
    });

    expect(result.usage).toBeNull();
    expect(result.sessionId).toBeNull();
  });

  test("rate-limit detection is case-insensitive across patterns", async () => {
    const patterns = ["You've Hit Your Limit", "RATE LIMIT exceeded", "too many requests"];
    for (const text of patterns) {
      const adapter = createScriptedAdapter({
        events: [textEvent(text), resultEvent()],
        usage: sampleUsage,
      });
      const result = await consumeEngineEvents(adapter, {
        engine: "claude",
        onFeedEvent: () => {},
      });
      expect(result.rateLimited).toBe(true);
    }
  });
});
