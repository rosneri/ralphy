import { describe, expect, test } from "bun:test";
import { isAbsolute, resolve } from "node:path";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  parseWorkflowPathArgs,
} from "../common-args";

describe("parseCommonArg", () => {
  test("parses --claude with model", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--claude", args, state)).toBe(true);
    expect(parseCommonArg("sonnet", args, state)).toBe(true);
    expect(args.engine).toBe("claude");
    expect(args.model).toBe("sonnet");
    expect(args.engineSet).toBe(true);
  });

  test("parses --max-iterations value", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--max-iterations", args, state);
    parseCommonArg("12", args, state);
    expect(args.maxIterations).toBe(12);
  });

  test("rejects conflicting engine flags", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--claude", args, state);
    parseCommonArg("--max-iterations", args, state);
    parseCommonArg("3", args, state);
    expect(() => parseCommonArg("--codex", args, state)).toThrow("Choose only one engine flag");
  });

  test("resolves --workflow value to an absolute path against cwd", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--workflow", args, state)).toBe(true);
    expect(parseCommonArg("config/WORKFLOW.md", args, state)).toBe(true);
    expect(args.workflowFile).toBe(resolve("config/WORKFLOW.md"));
    expect(isAbsolute(args.workflowFile ?? "")).toBe(true);
  });

  test("returns false for unknown args", () => {
    const args = initialCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--unknown", args, state)).toBe(false);
  });
});

describe("parseWorkflowPathArgs", () => {
  test("extracts only the path overrides, ignoring other tokens", () => {
    const result = parseWorkflowPathArgs([
      "execute",
      "--max-iterations",
      "5",
      "--project-root",
      "/tmp/proj",
      "--workflow",
      "config/WORKFLOW.md",
    ]);
    expect(result.projectRoot).toBe("/tmp/proj");
    expect(result.workflowFile).toBe(resolve("config/WORKFLOW.md"));
  });

  test("leaves both undefined when neither flag is present", () => {
    const result = parseWorkflowPathArgs(["agent", "--worktree"]);
    expect(result.projectRoot).toBeUndefined();
    expect(result.workflowFile).toBeUndefined();
  });
});
