import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Resolve to src/ even when this test runs from the compiled dist/ copy.
const SRC_DIR = import.meta.dir.replace("/dist/src/", "/src/");
const SRC = join(SRC_DIR, "..", "useLoop.ts");

// Orchestration (state init, iteration driving, steering, review phase,
// archive path, stop arithmetic, telemetry) lives in the headless
// LoopRunner (`@ralphy/core/loop-runner`, issue #401) and is covered by its
// boundary tests. The hook must stay a thin adapter.
describe("useLoop — thin adapter over LoopRunner (issue #401)", () => {
  test("delegates to createLoopRunner", async () => {
    const text = await Bun.file(SRC).text();
    expect(text.includes("createLoopRunner")).toBe(true);
    expect(text.includes("useSyncExternalStore")).toBe(true);
  });

  test("does not re-implement loop orchestration", async () => {
    const text = await Bun.file(SRC).text();
    // No direct engine access — iterations are driven by the runner.
    expect(text.includes("runEngine")).toBe(false);
    expect(text.includes("AbortController")).toBe(false);
    // No machine wiring — the runner owns the loopMachine actor.
    expect(text.includes("createActor")).toBe(false);
    expect(text.includes("loopMachine")).toBe(false);
    // No state-file writes — the runner is the only loop-state writer.
    expect(text.includes("writeState")).toBe(false);
    expect(text.includes("updateStateIteration")).toBe(false);
  });

  test("does not import @ralphy/telemetry or call capture() directly (RLF-96 Stage 7)", async () => {
    const text = await Bun.file(SRC).text();
    expect(text.includes('from "@ralphy/telemetry"')).toBe(false);
    expect(text.includes("from '@ralphy/telemetry'")).toBe(false);
    expect(/\bcapture\s*\(/.test(text)).toBe(false);
    // The loop.* bus events moved with the orchestration into the runner;
    // see packages/core/src/__tests__/loop-runner.test.ts.
    expect(text.includes("getProcessBus")).toBe(false);
  });
});
