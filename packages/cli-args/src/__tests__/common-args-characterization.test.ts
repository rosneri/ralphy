import { describe, expect, test } from "bun:test";
import { COMMON_CLI_OPTIONS, findField, modelOptionValues } from "@ralphy/workflow/fields";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  isCommonArg,
  isCommonExpectingFlag,
  type CommonArgs,
} from "../common-args";

/**
 * Characterization snapshot of the hand-rolled parser. Locks in the exact
 * argv → CommonArgs behavior so a later table-driven rewrite can be proven
 * equivalent. Update deliberately — a diff here is a behavior change.
 */
function parseAll(argv: string[]): CommonArgs {
  const args = initialCommonArgs();
  const state = emptyParseState();
  for (const token of argv) {
    if (!parseCommonArg(token, args, state)) {
      throw new Error(`unconsumed token: ${token}`);
    }
  }
  return args;
}

describe("parseCommonArg characterization", () => {
  test("every value + boolean flag lands in the expected field", () => {
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
      "--project-root",
      "/tmp/proj",
      "--name",
      "rlf-200",
      "--prompt",
      "do the thing",
      "--from-agent",
    ]);
    expect(args).toEqual({
      engine: "codex",
      model: "sonnet",
      engineSet: true,
      maxIterations: 42,
      maxCostUsd: 2.5,
      maxRuntimeMinutes: 90,
      maxConsecutiveFailures: 9,
      delay: 7,
      log: true,
      verbose: true,
      projectRoot: "/tmp/proj",
      name: "rlf-200",
      prompt: "do the thing",
      fromAgent: true,
    });
  });

  test("--claude takes an optional trailing model", () => {
    expect(parseAll(["--claude", "opus"]).model).toBe("opus");
    // A non-model token after --claude is not consumed as the model.
    const args = initialCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--claude", args, state)).toBe(true);
    expect(parseCommonArg("--verbose", args, state)).toBe(true); // not eaten as model
    expect(args.model).toBe("opus"); // unchanged default
    expect(args.verbose).toBe(true);
  });

  test("--unlimited forces maxIterations to 0", () => {
    expect(parseAll(["--max-iterations", "10", "--unlimited"]).maxIterations).toBe(0);
  });

  test("--prompt overrides an earlier --prompt-file (last-wins)", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--prompt-file", args, state);
    parseCommonArg("/tmp/p.txt", args, state);
    parseCommonArg("--prompt", args, state);
    parseCommonArg("inline", args, state);
    expect(args.prompt).toBe("inline");
    expect(state.promptFilePath).toBeNull();
  });

  test("conflicting engine flags throw", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--codex", args, state);
    expect(() => parseCommonArg("--claude", args, state)).toThrow("Choose only one engine flag");
  });

  test("invalid --model throws", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--model", args, state);
    expect(() => parseCommonArg("nope", args, state)).toThrow("Invalid model");
  });

  test("every CLI option is bound to a real catalogue field", () => {
    for (const option of COMMON_CLI_OPTIONS) {
      expect(findField(option.fieldId)).toBeDefined();
    }
  });

  test("the --model flag accepts exactly the catalogue's model values", () => {
    const models = modelOptionValues();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(parseAll(["--model", model]).model).toBe(model);
    }
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
    for (const flag of ["--codex", "--unlimited", "--log", "--verbose"]) {
      expect(isCommonExpectingFlag(flag)).toBe(false);
      expect(isCommonArg(flag)).toBe(true);
    }
    expect(isCommonArg("--name")).toBe(false); // bespoke, not classified as common
    expect(isCommonArg("--unknown")).toBe(false);
  });
});
