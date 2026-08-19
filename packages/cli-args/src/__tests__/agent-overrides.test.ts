import { describe, expect, test } from "bun:test";
import {
  AGENT_OVERRIDE_KEYS,
  AGENT_OVERRIDE_TO_WORKFLOW_KEY,
  type AgentOverrides,
} from "../agent-overrides";

describe("AgentOverrides machinery", () => {
  test("AGENT_OVERRIDE_KEYS covers exactly the 7 agent-only flags", () => {
    expect(([...AGENT_OVERRIDE_KEYS] as string[]).sort()).toEqual(
      [
        "codeReview",
        "concurrency",
        "createPr",
        "linearTeam",
        "pollInterval",
        "stackPrs",
        "worktree",
      ].sort(),
    );
  });

  test("AGENT_OVERRIDE_TO_WORKFLOW_KEY maps each key to its workflow key", () => {
    expect(AGENT_OVERRIDE_TO_WORKFLOW_KEY).toEqual({
      concurrency: "concurrency",
      pollInterval: "pollIntervalSeconds",
      linearTeam: "linear",
      worktree: "useWorktree",
      createPr: "createPrOnSuccess",
      stackPrs: "stackPrsOnDependencies",
      codeReview: "linear",
    });
  });

  test("the two nested linear keys both witness the 'linear' container", () => {
    expect(AGENT_OVERRIDE_TO_WORKFLOW_KEY.linearTeam).toBe("linear");
    expect(AGENT_OVERRIDE_TO_WORKFLOW_KEY.codeReview).toBe("linear");
  });

  test("the map's key set equals AGENT_OVERRIDE_KEYS", () => {
    expect(Object.keys(AGENT_OVERRIDE_TO_WORKFLOW_KEY).sort()).toEqual(
      [...AGENT_OVERRIDE_KEYS].sort(),
    );
  });

  test("an AgentOverrides bag is structurally sparse (no sentinels required)", () => {
    const empty: AgentOverrides = {};
    expect(Object.keys(empty)).toHaveLength(0);
  });
});
