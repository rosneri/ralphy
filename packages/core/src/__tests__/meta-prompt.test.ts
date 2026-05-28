import { describe, expect, test } from "bun:test";
import { buildMetaPrompt } from "../prompt/meta-prompt";
import type { MetaPromptOptions } from "../prompt/meta-prompt";
import { buildInitialState } from "../state";
import type { State } from "@ralphy/types";

function makeState(overrides: Partial<State> = {}): State {
  return { ...buildInitialState({ name: "test-change", prompt: "Test prompt" }), ...overrides };
}

describe("buildMetaPrompt", () => {
  test("returns empty string when enabled is false", () => {
    const result = buildMetaPrompt(makeState(), "execute", { enabled: false });
    expect(result).toBe("");
  });

  test("returns prompt by default (enabled not set)", () => {
    const result = buildMetaPrompt(makeState(), "execute");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns prompt when enabled is explicitly true", () => {
    const result = buildMetaPrompt(makeState(), "execute", { enabled: true });
    expect(result.length).toBeGreaterThan(0);
  });

  test("includes change name in preamble", () => {
    const result = buildMetaPrompt(makeState({ name: "my-feature" }), "execute");
    expect(result).toContain("`my-feature`");
  });

  test("includes engine and model", () => {
    const result = buildMetaPrompt(makeState({ engine: "codex", model: "sonnet" }), "plan");
    expect(result).toContain("codex / sonnet");
  });

  test("includes phase name for each phase", () => {
    for (const phase of ["research", "plan", "execute", "review"] as const) {
      const result = buildMetaPrompt(makeState(), phase);
      expect(result).toContain(`**Phase:** ${phase}`);
    }
  });

  test("shows iteration number 1-based", () => {
    const result = buildMetaPrompt(makeState({ iteration: 4 }), "execute");
    expect(result).toContain("**Iteration:** 5");
  });

  test("shows max iterations when provided and > 0", () => {
    const result = buildMetaPrompt(makeState({ iteration: 2 }), "execute", { maxIterations: 10 });
    expect(result).toContain("3 of 10");
  });

  test("omits max iterations cap when maxIterations is 0", () => {
    const result = buildMetaPrompt(makeState({ iteration: 2 }), "execute", { maxIterations: 0 });
    expect(result).not.toContain("of 0");
  });

  test("shows cost budget when maxCostUsd > 0", () => {
    const state = makeState();
    state.usage.total_cost_usd = 1.5;
    const result = buildMetaPrompt(state, "execute", { maxCostUsd: 5 });
    expect(result).toContain("$1.5000 of $5");
  });

  test("omits cost budget when maxCostUsd is 0", () => {
    const result = buildMetaPrompt(makeState(), "execute", { maxCostUsd: 0 });
    expect(result).not.toContain("Cost so far");
  });

  test("shows runtime budget when maxRuntimeMinutes > 0", () => {
    const result = buildMetaPrompt(makeState(), "execute", { maxRuntimeMinutes: 30 });
    expect(result).toContain("30 min");
  });

  test("omits runtime budget when maxRuntimeMinutes is 0", () => {
    const result = buildMetaPrompt(makeState(), "execute", { maxRuntimeMinutes: 0 });
    expect(result).not.toContain("Runtime budget");
  });

  test("includes research phase guidance", () => {
    const result = buildMetaPrompt(makeState(), "research");
    expect(result).toContain("Do NOT make any code changes");
  });

  test("includes plan phase guidance", () => {
    const result = buildMetaPrompt(makeState(), "plan");
    expect(result).toContain("Do NOT write implementation code yet");
  });

  test("includes execute phase guidance", () => {
    const result = buildMetaPrompt(makeState(), "execute");
    expect(result).toContain("tasks.md checklist");
  });

  test("includes review phase guidance", () => {
    const result = buildMetaPrompt(makeState(), "review");
    expect(result).toContain("Do NOT implement any fixes");
  });

  test("shows worktree flag when useWorktree is true", () => {
    const result = buildMetaPrompt(makeState(), "execute", { useWorktree: true });
    expect(result).toContain("Worktree mode: active");
  });

  test("shows worktree path when provided", () => {
    const result = buildMetaPrompt(makeState(), "execute", {
      useWorktree: true,
      worktreePath: "/tmp/wt/my-feature",
    });
    expect(result).toContain("/tmp/wt/my-feature");
  });

  test("omits worktree flag when not set", () => {
    const result = buildMetaPrompt(makeState(), "execute");
    expect(result).not.toContain("Worktree mode");
  });

  test("shows PR on success flag when createPr is true", () => {
    const result = buildMetaPrompt(makeState(), "execute", { createPr: true });
    expect(result).toContain("PR on success: yes");
  });

  test("omits PR flag when createPr is not set", () => {
    const result = buildMetaPrompt(makeState(), "execute");
    expect(result).not.toContain("PR on success");
  });

  test("shows confirmation mode flag when active", () => {
    const result = buildMetaPrompt(makeState(), "execute", { confirmationMode: true });
    expect(result).toContain("Confirmation mode: active");
  });

  test("shows Linear issue identifier and URL", () => {
    const opts: MetaPromptOptions = {
      linearIssueIdentifier: "RLF-123",
      linearIssueUrl: "https://linear.app/neriros/issue/RLF-123",
    };
    const result = buildMetaPrompt(makeState(), "execute", opts);
    expect(result).toContain("RLF-123");
    expect(result).toContain("https://linear.app/neriros/issue/RLF-123");
  });

  test("shows Linear identifier without URL when URL not provided", () => {
    const result = buildMetaPrompt(makeState(), "execute", {
      linearIssueIdentifier: "RLF-99",
    });
    expect(result).toContain("RLF-99");
    expect(result).not.toContain("undefined");
  });

  test("omits Active Flags section when no flags are set", () => {
    const result = buildMetaPrompt(makeState(), "execute");
    expect(result).not.toContain("Active Flags");
  });

  test("includes Active Flags section when any flag is set", () => {
    const result = buildMetaPrompt(makeState(), "execute", { createPr: true });
    expect(result).toContain("Active Flags");
  });
});
