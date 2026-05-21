import { describe, expect, test } from "bun:test";
import { createBus } from "@ralphy/events";
import type { Capability } from "../types";
import { runCapability } from "../run-capability";

function makeCap<R>(
  overrides: Partial<Capability<void, R>> & { run: () => Promise<R> },
): Capability<void, R> {
  return {
    name: "test.op",
    required: false,
    retryPolicy: { maxAttempts: 1, isRetryable: () => false, delayMs: () => 0 },
    errorFormatter: (e) => (e instanceof Error ? e.message : String(e)),
    ...overrides,
  };
}

describe("runCapability", () => {
  test("happy path emits started then fetched in order and returns the value", async () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    const cap = makeCap({ run: async () => 42 });

    const out = await runCapability(cap, undefined, { bus });
    expect(out).toBe(42);
    expect(seen).toEqual(["test.op.started", "test.op.fetched"]);
  });

  test("retries on transient failure and emits no .failed between attempts", async () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    let attempts = 0;
    const cap = makeCap({
      retryPolicy: { maxAttempts: 3, isRetryable: () => true, delayMs: () => 0 },
      run: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`transient ${attempts}`);
        return "ok";
      },
    });

    const out = await runCapability(cap, undefined, { bus });
    expect(out).toBe("ok");
    expect(attempts).toBe(3);
    expect(seen).toEqual(["test.op.started", "test.op.fetched"]);
  });

  test("required: true rethrows the original error and produces no value", async () => {
    const bus = createBus();
    const seen: { type: string; error?: unknown }[] = [];
    bus.on("*", (e) => seen.push({ type: e.type, error: (e as { error?: unknown }).error }));
    const boom = new Error("required boom");
    const cap = makeCap({
      required: true,
      run: async () => {
        throw boom;
      },
    });

    let caught: unknown;
    try {
      await runCapability(cap, undefined, { bus });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(seen.map((e) => e.type)).toEqual(["test.op.started", "test.op.failed"]);
    expect(seen[1]?.error).toBe("required boom");
  });

  test("errorFormatter is called exactly once on terminal failure", async () => {
    const bus = createBus();
    let formatCalls = 0;
    const cap = makeCap({
      retryPolicy: { maxAttempts: 3, isRetryable: () => true, delayMs: () => 0 },
      errorFormatter: (e) => {
        formatCalls += 1;
        return e instanceof Error ? e.message : "x";
      },
      run: async () => {
        throw new Error("nope");
      },
    });
    await expect(runCapability(cap, undefined, { bus })).rejects.toThrow("nope");
    expect(formatCalls).toBe(1);
  });

  test("non-retryable error fails fast without further attempts", async () => {
    const bus = createBus();
    let attempts = 0;
    const cap = makeCap({
      retryPolicy: { maxAttempts: 5, isRetryable: () => false, delayMs: () => 0 },
      run: async () => {
        attempts += 1;
        throw new Error("auth");
      },
    });
    await expect(runCapability(cap, undefined, { bus })).rejects.toThrow("auth");
    expect(attempts).toBe(1);
  });

  test("adopt narrows the raw payload before emitting fetched", async () => {
    const bus = createBus();
    const cap: Capability<void, { count: number }> = {
      name: "adopt.op",
      required: false,
      retryPolicy: { maxAttempts: 1, isRetryable: () => false, delayMs: () => 0 },
      errorFormatter: (e) => String(e),
      adopt: (raw) => ({ count: (raw as { items: unknown[] }).items.length }),
      run: (async () => ({ items: [1, 2, 3] })) as unknown as () => Promise<{ count: number }>,
    };
    const out = await runCapability(cap, undefined, { bus });
    expect(out).toEqual({ count: 3 });
  });

  test("runs without a bus", async () => {
    const cap = makeCap({ run: async () => 1 });
    expect(await runCapability(cap, undefined)).toBe(1);
  });
});
