import { describe, expect, test } from "bun:test";
import {
  COMMON_CLI_OPTIONS,
  effortOptionValues,
  modelOptionValues,
} from "@ralphy/workflow/cli-options";
import {
  emptyCommonArgs,
  parseCommonArg,
  parseCommonArgv,
  emptyParseState,
  isCommonArg,
  isCommonExpectingFlag,
  type CommonArgs,
} from "../common-args";

/**
 * Characterization snapshot of the sparse parser. Locks in the exact
 * argv → CommonArgs behavior — `overrides` carries exactly the keys the user
 * passed, nothing else. Update deliberately: a diff here is a behavior change.
 */
function parseAll(argv: string[]): CommonArgs {
  const args = emptyCommonArgs();
  const state = emptyParseState();
  for (const token of argv) {
    if (!parseCommonArg(token, args, state)) {
      throw new Error("unconsumed token in characterization parse");
    }
  }
  return args;
}

describe("parseCommonArg characterization", () => {
  test("every value + boolean flag lands in the expected override key", () => {
    const args = parseAll([
      "--codex",
      "--model",
      "sonnet",
      "--delay",
      "7",
      "--max-cost",
      "2.5",
      "--max-runtime",
      "90",
      "--max-failures",
      "9",
      "--max-iterations",
      "42",
      "--log",
      "--verbose",
      "--manual-test",
      "--project-root",
      "/tmp/proj",
      "--name",
      "rlf-200",
      "--prompt",
      "do the thing",
      "--from-agent",
    ]);
    expect(args).toEqual({
      overrides: {
        engine: "codex",
        model: "sonnet",
        maxIterations: 42,
        maxCostUsd: 2.5,
        maxRuntimeMinutes: 90,
        maxConsecutiveFailures: 9,
        delay: 7,
        log: true,
        verbose: true,
        manualTest: true,
      },
      projectRoot: "/tmp/proj",
      workflowFile: undefined,
      name: "rlf-200",
      prompt: "do the thing",
      fromAgent: true,
    });
  });

  test("an empty argv yields empty overrides — presence carries intent", () => {
    expect(parseAll([]).overrides).toEqual({});
  });

  test("--claude takes an optional trailing model", () => {
    expect(parseAll(["--claude", "opus"]).overrides).toEqual({
      engine: "claude",
      model: "opus",
    });
    // A non-model token after --claude is not consumed as the model.
    const args = emptyCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--claude", args, state)).toBe(true);
    expect(parseCommonArg("--verbose", args, state)).toBe(true); // not eaten as model
    expect(args.overrides.model).toBeUndefined(); // not set — no baked default
    expect(args.overrides.verbose).toBe(true);
  });

  test("a bare --codex sets only the engine, never a model", () => {
    expect(parseAll(["--codex"]).overrides).toEqual({ engine: "codex" });
  });

  test("--unlimited records an explicit maxIterations of 0", () => {
    expect(parseAll(["--max-iterations", "10", "--unlimited"]).overrides.maxIterations).toBe(0);
    // Even alone, --unlimited is an explicit override (it must beat a
    // WORKFLOW.md maxIterationsPerTask), not an absent key.
    expect(parseAll(["--unlimited"]).overrides.maxIterations).toBe(0);
  });

  test("passing a flag at its default value is still recorded", () => {
    // The old parser could not distinguish `--max-failures 5` from "not
    // passed" — the sentinel bug. Sparse overrides fix it by construction.
    expect(parseAll(["--max-failures", "5"]).overrides.maxConsecutiveFailures).toBe(5);
  });

  test("--prompt overrides an earlier --prompt-file (last-wins)", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--prompt-file", args, state);
    parseCommonArg("/tmp/p.txt", args, state);
    parseCommonArg("--prompt", args, state);
    parseCommonArg("inline", args, state);
    expect(args.prompt).toBe("inline");
    expect(state.promptFilePath).toBeNull();
  });

  test("conflicting engine flags throw", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--codex", args, state);
    expect(() => parseCommonArg("--claude", args, state)).toThrow("Choose only one engine flag");
  });

  test("repeating the same engine flag is allowed", () => {
    expect(parseAll(["--codex", "--codex"]).overrides.engine).toBe("codex");
  });

  test("invalid --model throws", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--model", args, state);
    expect(() => parseCommonArg("nope", args, state)).toThrow("Invalid model");
  });

  test("the --model flag accepts exactly the schema's model values", () => {
    const models = modelOptionValues();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(parseAll(["--model", model]).overrides.model).toBe(model);
    }
  });

  test("parseCommonArgv returns unconsumed tokens for bespoke parsing", async () => {
    const { args, rest } = await parseCommonArgv([
      "task",
      "--max-iterations",
      "3",
      "--worktree",
      "--name",
      "rlf-9",
    ]);
    expect(args.overrides).toEqual({ maxIterations: 3 });
    expect(args.name).toBe("rlf-9");
    expect(rest).toEqual(["task", "--worktree"]);
  });

  test("parseCommonArgv reads --prompt-file through the injected reader", async () => {
    const { args } = await parseCommonArgv(["--prompt-file", "/virtual/p.txt"], async (path) => {
      expect(path).toBe("/virtual/p.txt");
      return "from the fake fs";
    });
    expect(args.prompt).toBe("from the fake fs");
  });

  test("flag classification helpers", () => {
    for (const flag of [
      "--model",
      "--delay",
      "--max-cost",
      "--max-runtime",
      "--max-failures",
      "--max-iterations",
      "--project-root",
      "--claude",
    ]) {
      expect(isCommonExpectingFlag(flag)).toBe(true);
      expect(isCommonArg(flag)).toBe(true);
    }
    for (const flag of ["--codex", "--unlimited", "--log", "--verbose", "--manual-test"]) {
      expect(isCommonExpectingFlag(flag)).toBe(false);
      expect(isCommonArg(flag)).toBe(true);
    }
    expect(isCommonArg("--name")).toBe(false); // bespoke, not classified as common
    expect(isCommonArg("--unknown")).toBe(false);
  });

  test("every CLI option has a setter wired in the parser", () => {
    // Exercise each flag end-to-end so an option added to the catalogue
    // without a matching setter fails here, not at first real use.
    for (const option of COMMON_CLI_OPTIONS) {
      const argv = option.kind === "boolean" ? [option.flag] : [option.flag, sample(option.kind)];
      expect(() => parseAll(argv)).not.toThrow();
    }
  });
});

function sample(kind: "int" | "float" | "model" | "effort"): string {
  if (kind === "model") return modelOptionValues()[0] ?? "opus";
  if (kind === "effort") return effortOptionValues()[0] ?? "medium";
  return kind === "int" ? "3" : "1.5";
}
