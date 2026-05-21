import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpFs } from "../tmp-fs";

describe("createTmpFs", () => {
  test("seeds tasks, proposal, design and mutates state", async () => {
    const fs = await createTmpFs();
    const tasksPath = await fs.seedTasks("ch-1", ["- [ ] do thing", "- [ ] do other"]);
    const proposalPath = await fs.seedProposal("ch-1", "## Why\n\nbecause\n");
    const designPath = await fs.seedDesign("ch-1", "## Design\n");
    expect(existsSync(tasksPath)).toBe(true);
    expect(existsSync(proposalPath)).toBe(true);
    expect(existsSync(designPath)).toBe(true);

    await fs.mutateState("ch-1", () => ({ iteration: 1, status: "running" }));
    await fs.mutateState("ch-1", (prev) => ({ ...prev, iteration: 2 }));
    const stateFile = join(fs.ralphRoot, "tasks", "ch-1", ".ralph-state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
      iteration: number;
      status: string;
    };
    expect(state.iteration).toBe(2);
    expect(state.status).toBe("running");

    await fs.cleanup();
    expect(existsSync(fs.root)).toBe(false);
  });
});
