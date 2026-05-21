import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Stage 7 telemetry surface invariant.
//
// The full migration of every legacy `onLog(...)` callback in
// apps/agent/src/runtime/coordinator.ts and the smaller feature helpers is
// tracked as remaining work for later stages. This test enforces that the
// files that *were* migrated in this stage (wire.ts and useLoop.ts) do not
// regress back to direct `capture(...)` / `onLog(...)` calls, which is the
// regression we care about right now.
describe("telemetry surface invariant", () => {
  test("migrated files have no direct capture()/onLog() calls", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..");
    const targets = ["apps/agent/src/agent/wire.ts", "apps/loop/src/hooks/useLoop.ts"];
    const offenders: string[] = [];
    for (const rel of targets) {
      const text = await Bun.file(join(repoRoot, rel)).text();
      if (/\bcapture\(|\bonLog\(/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
