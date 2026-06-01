import { inspectMachine } from "@rosneri/xstate-mcp";
import { describe, expect, test } from "bun:test";
import { mcpMachineRegistry } from "../mcp-registry";

describe("mcpMachineRegistry", () => {
  test("contains exactly flow, loop, example with expected supportsSimulation", () => {
    const byName = Object.fromEntries(mcpMachineRegistry.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(["example", "flow", "loop"]);
    expect(byName.flow!.supportsSimulation).toBe(true);
    expect(byName.loop!.supportsSimulation).toBe(false);
    expect(byName.example!.supportsSimulation).toBe(true);
  });

  test("names are unique", () => {
    const names = mcpMachineRegistry.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every entry's machine is defined and inspectMachine succeeds", () => {
    for (const entry of mcpMachineRegistry) {
      expect(entry.machine).toBeDefined();
      const inspection = inspectMachine(entry);
      expect(inspection.name).toBe(entry.name);
      expect(inspection.totalStateCount).toBeGreaterThan(0);
    }
  });
});
