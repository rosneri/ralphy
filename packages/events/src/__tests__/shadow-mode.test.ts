import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import { BufferSink, subscribeTuiStream } from "../consumers/tui-stream";
import { JsonBufferSink, subscribeJsonOutput } from "../consumers/json-output";
import { subscribePostHog, POSTHOG_EVENT_ALLOWLIST } from "../consumers/posthog";

/**
 * Shadow-mode integration. Stage 1 wires the shadow consumers to
 * BufferSinks; this test pushes a small representative event stream
 * through both and asserts the buffers' shape matches the production
 * wire format (`runAgentJson`'s JSON-per-line + the legacy onLog text
 * formatting). The full byte-for-byte cross-check against the Stage 0
 * goldens lives in Stage 2 once the additive emits at every call site
 * are exercised by the characterization scenario.
 */

describe("shadow consumers", () => {
  test("tui-stream mirrors log events with color", () => {
    const bus = createBus();
    const sink = new BufferSink();
    subscribeTuiStream(bus, sink);
    bus.emit({ type: "log", text: "hello", color: "cyan" });
    bus.emit({ type: "log", text: "plain" });
    expect(sink.lines()).toEqual(["[cyan] hello", "plain"]);
  });

  test("json-output mirrors runAgentJson wire format", () => {
    const bus = createBus();
    const sink = new JsonBufferSink();
    subscribeJsonOutput(bus, sink);
    const ts = 1_700_000_000_000;
    bus.emit({ type: "started", version: "x", ts });
    bus.emit({ type: "log", text: "yo", color: "gray", ts });
    bus.emit({
      type: "poll_done",
      ts,
      found: 0,
      added: 0,
      buckets: { todo: 0, inProgress: 0, conflicted: 0, review: 0, mentions: 0, awaiting: 0 },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0 },
    });
    const lines = sink.lines();
    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(first["type"]).toBe("started");
    expect(first["ts"]).toBe(ts);
  });

  test("json-output ignores capture-only events", () => {
    const bus = createBus();
    const sink = new JsonBufferSink();
    subscribeJsonOutput(bus, sink);
    bus.emit({ type: "command_run", subcommand: "agent" });
    expect(sink.lines()).toEqual([]);
  });

  test("posthog consumer forwards every allowlisted event with type/ts stripped", () => {
    const bus = createBus();
    const calls: { event: string; props: Record<string, unknown> | undefined }[] = [];
    subscribePostHog(bus, (event, props) => calls.push({ event, props }));
    bus.emit({ type: "command_run", subcommand: "agent" });
    bus.emit({ type: "log", text: "ignored" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.event).toBe("command_run");
    expect(calls[0]?.props).toEqual({ subcommand: "agent" });
    expect(POSTHOG_EVENT_ALLOWLIST.has("command_run")).toBe(true);
  });
});
