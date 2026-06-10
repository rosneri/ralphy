import { describe, expect, test } from "bun:test";
import { isAbsolute, resolve } from "node:path";
import {
  emptyCommonArgs,
  parseCommonArg,
  emptyParseState,
  parseWorkflowPathArgs,
} from "../common-args";

describe("parseCommonArg", () => {
  test("parses --claude with model into sparse overrides", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--claude", args, state)).toBe(true);
    expect(parseCommonArg("sonnet", args, state)).toBe(true);
    expect(args.overrides.engine).toBe("claude");
    expect(args.overrides.model).toBe("sonnet");
  });

  test("parses --max-iterations value", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--max-iterations", args, state);
    parseCommonArg("12", args, state);
    expect(args.overrides.maxIterations).toBe(12);
  });

  test("rejects conflicting engine flags", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--claude", args, state);
    parseCommonArg("--max-iterations", args, state);
    parseCommonArg("3", args, state);
    expect(() => parseCommonArg("--codex", args, state)).toThrow("Choose only one engine flag");
  });

  test("resolves --workflow value to an absolute path against cwd", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--workflow", args, state)).toBe(true);
    expect(parseCommonArg("config/WORKFLOW.md", args, state)).toBe(true);
    expect(args.workflowFile).toBe(resolve("config/WORKFLOW.md"));
    expect(isAbsolute(args.workflowFile ?? "")).toBe(true);
  });

  test("returns false for unknown args", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    expect(parseCommonArg("--unknown", args, state)).toBe(false);
  });

  test("flags the user did not pass stay absent — no baked defaults", () => {
    const args = emptyCommonArgs();
    const state = emptyParseState();
    parseCommonArg("--max-cost", args, state);
    parseCommonArg("2.5", args, state);
    expect(args.overrides).toEqual({ maxCostUsd: 2.5 });
  });
});

describe("parseWorkflowPathArgs", () => {
  test("extracts the path overrides, resolving --workflow against --project-root", () => {
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
    // A relative --workflow resolves against --project-root, not cwd.
    expect(result.workflowFile).toBe(resolve("/tmp/proj", "config/WORKFLOW.md"));
  });

  test("resolves --workflow before --project-root on the command line too", () => {
    const result = parseWorkflowPathArgs(["--workflow", "alt.md", "--project-root", "/tmp/proj"]);
    expect(result.workflowFile).toBe(resolve("/tmp/proj", "alt.md"));
  });

  test("an absolute --workflow is unaffected by --project-root", () => {
    const result = parseWorkflowPathArgs([
      "--project-root",
      "/tmp/proj",
      "--workflow",
      "/etc/ralphy/WORKFLOW.md",
    ]);
    expect(result.workflowFile).toBe("/etc/ralphy/WORKFLOW.md");
  });

  test("without --project-root, --workflow stays cwd-relative", () => {
    const result = parseWorkflowPathArgs(["--workflow", "config/WORKFLOW.md"]);
    expect(result.workflowFile).toBe(resolve("config/WORKFLOW.md"));
  });

  test("leaves both undefined when neither flag is present", () => {
    const result = parseWorkflowPathArgs(["agent", "--worktree"]);
    expect(result.projectRoot).toBeUndefined();
    expect(result.workflowFile).toBeUndefined();
  });
});
