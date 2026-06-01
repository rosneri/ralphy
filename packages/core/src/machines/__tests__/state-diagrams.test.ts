import { exportStateDiagram, inspectMachine } from "@rosneri/xstate-mcp";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mcpMachineRegistry } from "../mcp-registry";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..");
const exporter = join(repoRoot, "scripts", "export-state-diagrams.ts");

describe("state-machine diagrams", () => {
  test("every registry entry exports a stateDiagram-v2 block", () => {
    for (const entry of mcpMachineRegistry) {
      const diagram = exportStateDiagram(inspectMachine(entry));
      expect(diagram.startsWith("stateDiagram-v2")).toBe(true);
      expect(diagram.length).toBeGreaterThan(0);
    }
  });

  test("--check reports no drift on the committed docs", async () => {
    const proc = Bun.spawn(["bun", exporter, "--check"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      // Surface the offending paths to make the failure actionable.
      throw new Error(await new Response(proc.stderr).text());
    }
    expect(exitCode).toBe(0);
  });
});
