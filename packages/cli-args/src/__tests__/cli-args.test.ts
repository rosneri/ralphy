import { describe, expect, test } from "bun:test";
import { isAbsolute, resolve } from "node:path";
import { initialCommonArgs, parseCommonArg, emptyParseState } from "../common-args";

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
