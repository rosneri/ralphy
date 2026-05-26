import { describe, expect, test } from "bun:test";
import { parseTaskArgs } from "../task-cli";

describe("parseTaskArgs — valid phases", () => {
  test("parses 'execute' phase with --name", async () => {
    const args = await parseTaskArgs(["execute", "--name", "my-change"]);
    expect(args.phase).toBe("execute");
    expect(args.name).toBe("my-change");
  });

  test("parses 'research' phase", async () => {
    const args = await parseTaskArgs(["research", "--name", "my-change"]);
    expect(args.phase).toBe("research");
  });

  test("parses 'plan' phase", async () => {
    const args = await parseTaskArgs(["plan", "--name", "my-change"]);
    expect(args.phase).toBe("plan");
  });

  test("parses 'review' phase", async () => {
    const args = await parseTaskArgs(["review", "--name", "my-change"]);
    expect(args.phase).toBe("review");
  });
});

describe("parseTaskArgs — errors", () => {
  test("throws when no phase is given", async () => {
    await expect(parseTaskArgs(["--name", "my-change"])).rejects.toThrow(/Missing phase/);
  });

  test("throws on unknown phase argument", async () => {
    await expect(parseTaskArgs(["unknown-phase", "--name", "my-change"])).rejects.toThrow(
      /Unknown argument/,
    );
  });

  test("throws when --name is missing", async () => {
    await expect(parseTaskArgs(["execute"])).rejects.toThrow(/--name is required/);
  });
});

describe("parseTaskArgs — common flags", () => {
  test("parses --max-iterations", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--max-iterations", "5"]);
    expect(args.maxIterations).toBe(5);
  });

  test("parses --max-cost", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--max-cost", "2.5"]);
    expect(args.maxCostUsd).toBe(2.5);
  });

  test("parses --max-runtime", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--max-runtime", "30"]);
    expect(args.maxRuntimeMinutes).toBe(30);
  });

  test("parses --max-failures", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--max-failures", "3"]);
    expect(args.maxConsecutiveFailures).toBe(3);
  });

  test("parses --log flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--log"]);
    expect(args.log).toBe(true);
  });

  test("parses --verbose flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--verbose"]);
    expect(args.verbose).toBe(true);
  });

  test("parses --claude engine", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--claude"]);
    expect(args.engine).toBe("claude");
  });

  test("parses --claude with model", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--claude", "sonnet"]);
    expect(args.engine).toBe("claude");
    expect(args.model).toBe("sonnet");
  });

  test("parses --codex engine", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--codex"]);
    expect(args.engine).toBe("codex");
  });

  test("parses --model flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--model", "haiku"]);
    expect(args.model).toBe("haiku");
  });

  test("parses --delay flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--delay", "10"]);
    expect(args.delay).toBe(10);
  });

  test("parses --from-agent flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--from-agent"]);
    expect(args.fromAgent).toBe(true);
  });

  test("parses --prompt flag", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo", "--prompt", "do the thing"]);
    expect(args.prompt).toBe("do the thing");
  });

  test("defaults: fromAgent=false, engine=claude, model=opus", async () => {
    const args = await parseTaskArgs(["execute", "--name", "foo"]);
    expect(args.fromAgent).toBe(false);
    expect(args.engine).toBe("claude");
    expect(args.model).toBe("opus");
  });
});
