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
    const proc = Bun.spawn({
      cmd: ["rg", "-l", "capture\\(|onLog\\(", ...targets],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const files = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(files).toEqual([]);
  });
});
