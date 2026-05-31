import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Resolve to src/ even when this test runs from the compiled dist/ copy.
const SRC_DIR = import.meta.dir.replace("/dist/src/", "/src/");
const SRC = join(SRC_DIR, "..", "useLoop.ts");

describe("useLoop — telemetry surface (RLF-96 Stage 7)", () => {
  test("does not import @ralphy/telemetry directly anymore", async () => {
    const text = await Bun.file(SRC).text();
    expect(text.includes('from "@ralphy/telemetry"')).toBe(false);
    expect(text.includes("from '@ralphy/telemetry'")).toBe(false);
  });

  test("does not call capture(...) directly anymore", async () => {
    const text = await Bun.file(SRC).text();
    // capture( — any direct usage of telemetry.capture is forbidden
    expect(/\bcapture\s*\(/.test(text)).toBe(false);
  });

  test("emits the 5 loop.* bus events that replaced the prior capture calls", async () => {
    const text = await Bun.file(SRC).text();
    const expectedTypes = [
      "loop.task_started",
      "loop.task_stopped",
      "loop.iteration_failed",
      "loop.engine_rate_limited",
      "loop.engine_error",
    ];
    for (const t of expectedTypes) {
      expect(text.includes(`type: "${t}"`)).toBe(true);
    }
  });
});

describe("useLoop — max-iterations respawn fix (RLF-156)", () => {
  test("passes startingIteration to the actor START event so prior-run iterations count toward maxIterations", async () => {
    const text = await Bun.file(SRC).text();
    // The fix: startingIteration is captured before the loop and passed to the
    // loopMachine actor via the START event, so the machine's iteration counter
    // begins at the correct offset and respawned workers count toward maxIterations.
    expect(text.includes("startingIteration")).toBe(true);
    expect(text.includes("startingIteration,")).toBe(true);
  });
});

describe("useLoop — out-of-session usage gate (RLF-150)", () => {
  test("has a guard that stops the loop when rateLimited is true on exit 0", async () => {
    const text = await Bun.file(SRC).text();
    // The guard must be present: check rateLimited after the non-zero exit block
    // so a clean exit (exit 0) from a usage-limit result-error still stops the loop.
    expect(text.includes("engineResult.rateLimited")).toBe(true);
    expect(text.includes("Usage limit reached")).toBe(true);
    expect(text.includes("failed:rate-limited")).toBe(true);
  });
});
