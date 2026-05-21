import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "useLoop.ts");

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
