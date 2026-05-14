import { describe, expect, test, spyOn } from "bun:test";
import { parseArgs, printHelp, VERSION } from "../cli";

describe("agent parseArgs", () => {
  test("parses linear/concurrency flags", async () => {
    const result = await parseArgs([
      "--linear-team",
      "ENG",
      "--linear-assignee",
      "me",
      "--poll-interval",
      "30",
      "--concurrency",
      "4",
    ]);
    expect(result.linearTeam).toBe("ENG");
    expect(result.linearAssignee).toBe("me");
    expect(result.pollInterval).toBe(30);
    expect(result.concurrency).toBe(4);
  });

  test("parses --worktree flag", async () => {
    const result = await parseArgs(["--worktree"]);
    expect(result.worktree).toBe(true);
  });

  test("worktree defaults to false", async () => {
    const result = await parseArgs([]);
    expect(result.worktree).toBe(false);
  });

  test("--indicator builds get / set entries; multiple set flags merge into apply[]", async () => {
    const result = await parseArgs([
      "--indicator",
      "getTodo:status:Todo",
      "--indicator",
      "getTodo:label:ready",
      "--indicator",
      "setDone:status:Done",
      "--indicator",
      "setDone:label:shipped",
    ]);
    expect(result.indicators.getTodo).toEqual({
      filter: [
        { type: "status", value: "Todo" },
        { type: "label", value: "ready" },
      ],
    });
    expect(result.indicators.setDone).toEqual([
      { type: "status", value: "Done" },
      { type: "label", value: "shipped" },
    ]);
  });

  test("--indicator rejects unknown key / type / empty value", async () => {
    await expect(parseArgs(["--indicator", "bogus:label:x"])).rejects.toThrow(
      "unknown indicator key",
    );
    await expect(parseArgs(["--indicator", "setDone:badtype:x"])).rejects.toThrow(
      "indicator type must be",
    );
    await expect(parseArgs(["--indicator", "setDone:label:"])).rejects.toThrow(
      "value cannot be empty",
    );
    await expect(parseArgs(["--indicator", "no-colons"])).rejects.toThrow("expects key:type:value");
  });

  test("indicators default to empty object", async () => {
    const result = await parseArgs([]);
    expect(result.indicators).toEqual({});
  });

  test("parses --create-pr flag", async () => {
    expect((await parseArgs(["--create-pr"])).createPr).toBe(true);
    expect((await parseArgs([])).createPr).toBe(false);
  });

  test("parses common engine flags", async () => {
    const result = await parseArgs(["--claude", "sonnet"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("sonnet");
  });
});

describe("agent printHelp", () => {
  test("outputs usage text", () => {
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });
    try {
      printHelp();
    } finally {
      spy.mockRestore();
    }
    const output = logs.join("\n");
    expect(output).toContain("Usage: ralphy agent");
    expect(output).toContain(`ralphy agent v${VERSION}`);
  });
});
