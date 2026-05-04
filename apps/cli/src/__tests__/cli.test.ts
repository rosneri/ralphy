import { describe, expect, test, spyOn } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { parseArgs, printHelp } from "../cli";

describe("parseArgs", () => {
  test("defaults to task mode with claude/opus", async () => {
    const result = await parseArgs([]);
    expect(result.mode).toBe("task");
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.maxIterations).toBe(0);
    expect(result.log).toBe(false);
    expect(result.engineSet).toBe(false);
  });

  test("parses mode as first positional argument", async () => {
    expect((await parseArgs(["list"])).mode).toBe("list");
    expect((await parseArgs(["status"])).mode).toBe("status");
    expect((await parseArgs(["init"])).mode).toBe("init");
  });

  test("parses --name flag", async () => {
    const result = await parseArgs(["--name", "my-task"]);
    expect(result.name).toBe("my-task");
  });

  test("parses --prompt flag", async () => {
    const result = await parseArgs(["--prompt", "Add dark mode"]);
    expect(result.prompt).toBe("Add dark mode");
  });

  test("parses --prompt-file flag", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cli-test-"));
    const promptFile = join(tempDir, "prompt.txt");
    await Bun.write(promptFile, "Task from file");
    try {
      const result = await parseArgs(["--prompt-file", promptFile]);
      expect(result.prompt).toBe("Task from file");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parses --claude without model (defaults to opus)", async () => {
    const result = await parseArgs(["--claude"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.engineSet).toBe(true);
  });

  test("parses --claude with model", async () => {
    const result = await parseArgs(["--claude", "sonnet"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("sonnet");
    expect(result.engineSet).toBe(true);
  });

  test("parses --claude haiku", async () => {
    const result = await parseArgs(["--claude", "haiku"]);
    expect(result.model).toBe("haiku");
  });

  test("parses --codex", async () => {
    const result = await parseArgs(["--codex"]);
    expect(result.engine).toBe("codex");
    expect(result.engineSet).toBe(true);
  });

  test("throws on conflicting engine flags", async () => {
    await expect(parseArgs(["--claude", "--codex"])).rejects.toThrow("Choose only one engine flag");
    await expect(parseArgs(["--codex", "--claude"])).rejects.toThrow("Choose only one engine flag");
  });

  test("throws on bare number (use --max-iterations instead)", async () => {
    await expect(parseArgs(["20"])).rejects.toThrow("Unknown argument");
  });

  test("parses --max-iterations flag", async () => {
    const result = await parseArgs(["--max-iterations", "20"]);
    expect(result.maxIterations).toBe(20);
  });

  test("parses --log", async () => {
    const result = await parseArgs(["--log"]);
    expect(result.log).toBe(true);
  });

  test("parses --delay with value", async () => {
    const result = await parseArgs(["--delay", "5"]);
    expect(result.delay).toBe(5);
  });

  test("parses --unlimited as maxIterations 0", async () => {
    const result = await parseArgs(["--max-iterations", "10", "--unlimited"]);
    expect(result.maxIterations).toBe(0);
  });

  test("ignores deprecated --timeout flag", async () => {
    const result = await parseArgs(["--timeout", "300"]);
    expect(result.mode).toBe("task");
  });

  test("ignores deprecated --push-interval flag", async () => {
    const result = await parseArgs(["--push-interval", "5"]);
    expect(result.mode).toBe("task");
  });

  test("throws on unknown argument", async () => {
    await expect(parseArgs(["--bogus"])).rejects.toThrow("Unknown argument");
  });

  test("parses complex real-world command", async () => {
    const result = await parseArgs([
      "task",
      "--max-iterations",
      "20",
      "--name",
      "dark-mode",
      "--prompt",
      "Add dark/light mode toggle",
      "--claude",
      "sonnet",
      "--log",
    ]);
    expect(result.mode).toBe("task");
    expect(result.maxIterations).toBe(20);
    expect(result.name).toBe("dark-mode");
    expect(result.prompt).toBe("Add dark/light mode toggle");
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("sonnet");
    expect(result.log).toBe(true);
  });

  test("--claude followed by non-model arg uses default model", async () => {
    const result = await parseArgs(["--claude", "--name", "test"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.name).toBe("test");
  });

  test("allows duplicate same-engine flags", async () => {
    const result = await parseArgs(["--claude", "--claude", "haiku"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("haiku");
  });

  test("parses --model flag", async () => {
    const result = await parseArgs(["--model", "sonnet"]);
    expect(result.model).toBe("sonnet");
  });

  test("parses --model haiku", async () => {
    const result = await parseArgs(["--model", "haiku"]);
    expect(result.model).toBe("haiku");
  });

  test("throws on invalid --model value", async () => {
    await expect(parseArgs(["--model", "gpt4"])).rejects.toThrow("Invalid model");
  });

  test("--model overrides --claude default", async () => {
    const result = await parseArgs(["--claude", "--model", "haiku"]);
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("haiku");
  });

  test("parses --max-cost flag", async () => {
    const result = await parseArgs(["--max-cost", "5.50"]);
    expect(result.maxCostUsd).toBe(5.5);
  });

  test("parses --max-runtime flag", async () => {
    const result = await parseArgs(["--max-runtime", "30"]);
    expect(result.maxRuntimeMinutes).toBe(30);
  });

  test("parses --max-failures flag", async () => {
    const result = await parseArgs(["--max-failures", "3"]);
    expect(result.maxConsecutiveFailures).toBe(3);
  });

  test("parses --verbose flag", async () => {
    const result = await parseArgs(["--verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("unknown argument error includes help hint", async () => {
    await expect(parseArgs(["--bogus"])).rejects.toThrow("ralph --help");
  });

  test("parses agent mode and linear/concurrency flags", async () => {
    const result = await parseArgs([
      "agent",
      "--linear-team",
      "ENG",
      "--linear-assignee",
      "me",
      "--linear-status",
      "Todo",
      "--linear-status",
      "In Progress",
      "--linear-label",
      "p1",
      "--linear-label",
      "bug",
      "--poll-interval",
      "30",
      "--concurrency",
      "4",
    ]);
    expect(result.mode).toBe("agent");
    expect(result.linearTeam).toBe("ENG");
    expect(result.linearAssignee).toBe("me");
    expect(result.linearStatus).toEqual(["Todo", "In Progress"]);
    expect(result.linearLabel).toEqual(["p1", "bug"]);
    expect(result.pollInterval).toBe(30);
    expect(result.concurrency).toBe(4);
  });
});

describe("printHelp", () => {
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
    expect(output).toContain("Usage: ralph");
    expect(output).toContain("--name");
    expect(output).toContain("--help");
    expect(output).toContain("Examples:");
  });
});
