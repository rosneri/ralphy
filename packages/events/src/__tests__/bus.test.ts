import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import type { RalphEvent } from "../types";

describe("bus", () => {
  test("emits in registration order to typed subscribers", () => {
    const bus = createBus();
    const calls: string[] = [];
    bus.on("log", (e) => calls.push(`a:${e.text}`));
    bus.on("log", (e) => calls.push(`b:${e.text}`));
    bus.emit({ type: "log", text: "hi" });
    expect(calls).toEqual(["a:hi", "b:hi"]);
  });

  test("'*' wildcard receives all events", () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    bus.emit({ type: "log", text: "x" });
    bus.emit({ type: "poll_start" });
    expect(seen).toEqual(["log", "poll_start"]);
  });

  test("default ts is set when omitted", () => {
    const bus = createBus();
    let captured: RalphEvent | undefined;
    bus.on("log", (e) => {
      captured = e;
    });
    const before = Date.now();
    bus.emit({ type: "log", text: "t" });
    const after = Date.now();
    expect(captured?.ts).toBeGreaterThanOrEqual(before);
    expect(captured?.ts).toBeLessThanOrEqual(after);
  });

  test("throwing subscriber is isolated and produces __bus_error__", () => {
    const bus = createBus();
    const calls: string[] = [];
    bus.on("log", () => {
      throw new Error("boom");
    });
    bus.on("log", (e) => calls.push(`ok:${e.text}`));
    const errs: RalphEvent[] = [];
    bus.on("__bus_error__", (e) => errs.push(e));
    bus.emit({ type: "log", text: "x" });
    expect(calls).toEqual(["ok:x"]);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.type).toBe("__bus_error__");
    const err = errs[0] as Extract<RalphEvent, { type: "__bus_error__" }>;
    expect(err.error_message).toBe("boom");
    expect(err.consumer).toContain("log#");
  });

  test("unsubscribe mid-dispatch does not skip siblings", () => {
    const bus = createBus();
    const calls: string[] = [];
    const offA = bus.on("log", () => {
      calls.push("a");
      offA();
    });
    bus.on("log", () => calls.push("b"));
    bus.emit({ type: "log", text: "x" });
    expect(calls).toEqual(["a", "b"]);
    bus.emit({ type: "log", text: "y" });
    expect(calls).toEqual(["a", "b", "b"]);
  });

  test("recursion depth caps at MAX_ERROR_DEPTH for chained failures", () => {
    const bus = createBus();
    let throws = 0;
    bus.on("__bus_error__", () => {
      throws += 1;
      throw new Error("err-handler-also-throws");
    });
    bus.on("log", () => {
      throw new Error("first");
    });
    bus.emit({ type: "log", text: "x" });
    expect(throws).toBeGreaterThan(0);
    expect(throws).toBeLessThanOrEqual(8);
  });

  test("snapshot() returns events in chronological order", () => {
    const bus = createBus(4);
    bus.emit({ type: "log", text: "1" });
    bus.emit({ type: "log", text: "2" });
    bus.emit({ type: "log", text: "3" });
    const snap = bus.snapshot();
    expect(snap.map((e) => (e as { text?: string }).text)).toEqual(["1", "2", "3"]);
  });
});
