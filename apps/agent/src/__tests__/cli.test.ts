import { describe, expect, test, spyOn } from "bun:test";
import { parseAgentArgs as parseArgs, printAgentHelp as printHelp, VERSION } from "../cli";

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

  test("--linear-assignee overrides the assignee for this run", async () => {
    const result = await parseArgs(["--linear-assignee", "dev@example.com"]);
    expect(result.linearAssignee).toBe("dev@example.com");
  });

  test("parses --worktree flag", async () => {
    const result = await parseArgs(["--worktree"]);
    expect(result.worktree).toBe(true);
  });

  test("worktree defaults to false", async () => {
    const result = await parseArgs([]);
    expect(result.worktree).toBe(false);
  });

  test("parses --workflow flag into an absolute path", async () => {
    const result = await parseArgs(["--workflow", "config/WORKFLOW.md"]);
    expect(result.workflowFile).toBe(`${process.cwd()}/config/WORKFLOW.md`);
  });

  test("resolves a relative --workflow against --project-root when both are given", async () => {
    const result = await parseArgs([
      "--project-root",
      "/tmp/proj",
      "--workflow",
      "config/WORKFLOW.md",
    ]);
    expect(result.workflowFile).toBe("/tmp/proj/config/WORKFLOW.md");
  });

  test("--pre-existing-error-check is a boolean override", async () => {
    const off = await parseArgs([]);
    expect(off.preExistingErrorCheck).toBeUndefined();
    const on = await parseArgs(["--pre-existing-error-check"]);
    expect(on.preExistingErrorCheck).toBe(true);
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

  test("--indicator accepts attachment type and value with spaces", async () => {
    const result = await parseArgs([
      "--indicator",
      "setInProgress:attachment:In Progress",
      "--indicator",
      "setDone:attachment:Done",
    ]);
    expect(result.indicators.setInProgress).toEqual({ type: "attachment", value: "In Progress" });
    expect(result.indicators.setDone).toEqual({ type: "attachment", value: "Done" });
  });

  test("--indicator accepts comment type for getX slots and supports text values", async () => {
    const result = await parseArgs(["--indicator", "getTodo:comment:ralph go"]);
    expect(result.indicators.getTodo).toEqual({
      filter: [{ type: "comment", value: "ralph go" }],
    });
  });

  test("--indicator merges attachment with other types into an array", async () => {
    const result = await parseArgs([
      "--indicator",
      "setDone:status:Done",
      "--indicator",
      "setDone:attachment:Completed",
    ]);
    expect(result.indicators.setDone).toEqual([
      { type: "status", value: "Done" },
      { type: "attachment", value: "Completed" },
    ]);
  });

  test("--indicator setPrReady is a set-indicator, not a get-indicator (RLF-214)", async () => {
    const result = await parseArgs(["--indicator", "setPrReady:status:In Review"]);
    // populated as a set-indicator (SetIndicator marker), NOT a GetIndicator { filter }
    expect(result.indicators.setPrReady).toEqual({ type: "status", value: "In Review" });
    expect(result.indicators.getTodo).toBeUndefined();
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

  test("parses --name, --prompt, --max-tickets, and mode argument", async () => {
    const result = await parseArgs([
      "list",
      "--name",
      "ENG-1",
      "--prompt",
      "hello",
      "--max-tickets",
      "3",
    ]);
    expect(result.mode).toBe("list");
    expect(result.name).toBe("ENG-1");
    expect(result.prompt).toBe("hello");
    expect(result.maxTickets).toBe(3);
  });

  test("parses --prompt-file by reading file contents", async () => {
    const tmp = `/tmp/ralphy-prompt-${Date.now()}.txt`;
    await Bun.write(tmp, "from file");
    const result = await parseArgs(["--prompt-file", tmp]);
    expect(result.prompt).toBe("from file");
  });

  test("parses remaining boolean flags", async () => {
    const result = await parseArgs([
      "--pr-recovery",
      "--stack-prs",
      "--create-pr",
      "--code-review",
      "--json-output",
      "--manual-test",
      "--debug",
    ]);
    expect(result.prRecoveryEnabled).toBe(true);
    expect(result.stackPrs).toBe(true);
    expect(result.codeReview).toBe(true);
    expect(result.jsonOutput).toBe(true);
    expect(result.manualTest).toBe(true);
    expect(result.debug).toBe(true);
  });

  test("--json-log-file captures the path; omitted when absent", async () => {
    const omitted = await parseArgs([]);
    expect(omitted.jsonLogFile).toBeUndefined();
    const provided = await parseArgs(["--json-log-file", "/tmp/x.jsonl"]);
    expect(provided.jsonLogFile).toBe("/tmp/x.jsonl");
  });

  test("parses --checks flag", async () => {
    expect((await parseArgs(["list", "--checks"])).checks).toBe(true);
    expect((await parseArgs(["list"])).checks).toBe(false);
  });

  test("parses --review flag", async () => {
    expect((await parseArgs(["list", "--review"])).review).toBe(true);
    expect((await parseArgs(["list"])).review).toBe(false);
  });

  test("parses --agent-debug flag; defaults to false", async () => {
    expect((await parseArgs(["--agent-debug"])).agentDebug).toBe(true);
    expect((await parseArgs([])).agentDebug).toBe(false);
  });

  test("rejects unknown argument with helpful hint", async () => {
    await expect(parseArgs(["--no-such-flag"])).rejects.toThrow("Unknown argument");
  });

  test("--indicator with only one colon rejects with expects key:type:value", async () => {
    await expect(parseArgs(["--indicator", "setDone:label"])).rejects.toThrow(
      "expects key:type:value",
    );
  });

  test("--ticket defaults to an empty token list", async () => {
    const result = await parseArgs([]);
    expect(result.ticketTokens).toEqual([]);
  });

  test("--ticket parses a single identifier", async () => {
    const result = await parseArgs(["--ticket", "RLF-208"]);
    expect(result.ticketTokens).toEqual(["RLF-208"]);
  });

  test("--ticket is repeatable and accumulates tokens", async () => {
    const result = await parseArgs(["--ticket", "RLF-208", "--ticket", "RLF-210"]);
    expect(result.ticketTokens).toEqual(["RLF-208", "RLF-210"]);
  });

  test("--ticket splits comma-separated values, trimming and dropping empties", async () => {
    const result = await parseArgs(["--ticket", "RLF-208, RLF-210 ,,208"]);
    expect(result.ticketTokens).toEqual(["RLF-208", "RLF-210", "208"]);
  });

  test("--ticket combines repeated and comma forms", async () => {
    const result = await parseArgs(["--ticket", "RLF-208,RLF-210", "--ticket", "211"]);
    expect(result.ticketTokens).toEqual(["RLF-208", "RLF-210", "211"]);
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
    expect(output).toContain("--ticket <id>");
  });
});
