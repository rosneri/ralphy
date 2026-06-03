import { describe, expect, test } from "bun:test";
import { composeAppendPrompt } from "../prepare";

// The worked second example of the RLF-211 extracted-helper pattern: a pure
// decision lifted out of the `prepare` closure so its precedence + empty-segment
// dropping is assertable without scaffolding a worktree or hitting Linear.

describe("composeAppendPrompt", () => {
  test("the CLI prompt wins over the config fallback", () => {
    expect(composeAppendPrompt("cli", "cfg", "")).toBe("cli");
  });

  test("falls back to the config append-prompt when no CLI prompt", () => {
    expect(composeAppendPrompt("", "cfg", "")).toBe("cfg");
  });

  test("joins the chosen prompt and the workflow prompt with a blank line", () => {
    expect(composeAppendPrompt("cli", "cfg", "wf")).toBe("cli\n\nwf");
  });

  test("drops empty segments so a blank render leaves no trailing separator", () => {
    expect(composeAppendPrompt("", "", "wf")).toBe("wf");
    expect(composeAppendPrompt("", "", "")).toBe("");
  });
});
