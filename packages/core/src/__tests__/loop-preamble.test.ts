import { describe, expect, test } from "bun:test";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import {
  buildLoopPreamble,
  getStageBlock,
  buildDynamicLoopBlock,
  buildLoopLevelPrompt,
  type LoopPreambleContext,
} from "../loop";

const withCtx = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

function makeCtx(overrides: Partial<LoopPreambleContext> = {}): LoopPreambleContext {
  return {
    currentIteration: 3,
    maxIterations: 10,
    currentCostUsd: 0.5,
    maxCostUsd: 5.0,
    elapsedMinutes: 10,
    maxRuntimeMinutes: 60,
    pass: "normal",
    confirmationEnabled: false,
    confirmationRound: 0,
    createPrOnSuccess: false,
    fixCiOnFailure: false,
    stackPrsOnDependencies: false,
    syncTasksToComment: false,
    useWorktree: false,
    ...overrides,
  };
}

describe("buildLoopPreamble", () => {
  test("includes budget lines when all caps set", () => {
    const ctx = makeCtx();
    const result = buildLoopPreamble(ctx);
    expect(result).toContain("3 of 10");
    expect(result).toContain("$0.50 (cap: $5.00)");
    expect(result).toContain("10 min elapsed (cap: 60 min)");
    expect(result).toContain("Pass type: normal");
    expect(result).toContain("Confirmation gate: disabled");
  });

  test("shows 'unlimited' when maxIterations is 0", () => {
    const ctx = makeCtx({ maxIterations: 0 });
    const result = buildLoopPreamble(ctx);
    expect(result).toContain("of unlimited");
  });

  test("shows 'no cap' for cost when maxCostUsd is 0", () => {
    const ctx = makeCtx({ maxCostUsd: 0 });
    const result = buildLoopPreamble(ctx);
    expect(result).toContain("cap: no cap");
  });

  test("shows 'no cap' for runtime when maxRuntimeMinutes is 0", () => {
    const ctx = makeCtx({ maxRuntimeMinutes: 0 });
    const result = buildLoopPreamble(ctx);
    expect(result).toContain("cap: no cap");
  });

  test("shows 'enabled' when confirmationEnabled is true", () => {
    const ctx = makeCtx({ confirmationEnabled: true, confirmationRound: 2 });
    const result = buildLoopPreamble(ctx);
    expect(result).toContain("Confirmation gate: enabled, round 2");
  });

  test("is fenced in --- delimiters", () => {
    const result = buildLoopPreamble(makeCtx());
    expect(result.startsWith("---\n")).toBe(true);
    expect(result).toContain("---\n\n");
  });
});

describe("getStageBlock", () => {
  const phases = ["proposal", "design", "tasks", "implement", "review", "done"] as const;

  for (const phase of phases) {
    test(`returns non-empty string for phase '${phase}'`, () => {
      const result = getStageBlock(phase);
      expect(result.length).toBeGreaterThan(0);
    });

    test(`result for '${phase}' contains phase keyword`, () => {
      const result = getStageBlock(phase);
      expect(result).toContain(phase);
    });
  }

  test("proposal block mentions proposal.md", () => {
    expect(getStageBlock("proposal")).toContain("proposal.md");
  });

  test("design block mentions design.md", () => {
    expect(getStageBlock("design")).toContain("design.md");
  });

  test("tasks block mentions tasks.md", () => {
    expect(getStageBlock("tasks")).toContain("tasks.md");
  });

  test("implement block mentions commit", () => {
    expect(getStageBlock("implement")).toContain("commit");
  });

  test("review block mentions audit", () => {
    expect(getStageBlock("review")).toContain("audit");
  });

  test("done block mentions all tasks checked off", () => {
    expect(getStageBlock("done")).toContain("checked off");
  });

  test("all phase blocks are fenced in --- delimiters", () => {
    for (const phase of phases) {
      const result = getStageBlock(phase);
      expect(result.startsWith("---\n")).toBe(true);
    }
  });
});

describe("buildDynamicLoopBlock", () => {
  test("includes convergence premise when maxIterations > 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxIterations: 10 }));
    expect(result).toContain("Convergence pressure");
  });

  test("omits convergence premise when maxIterations = 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxIterations: 0 }));
    expect(result).not.toContain("Convergence pressure");
  });

  test("includes cost premise when maxCostUsd > 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxCostUsd: 5.0 }));
    expect(result).toContain("Cost usage");
  });

  test("omits cost premise when maxCostUsd = 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxCostUsd: 0 }));
    expect(result).not.toContain("Cost usage");
  });

  test("includes runtime premise when maxRuntimeMinutes > 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxRuntimeMinutes: 60 }));
    expect(result).toContain("Runtime:");
  });

  test("omits runtime premise when maxRuntimeMinutes = 0", () => {
    const result = buildDynamicLoopBlock(makeCtx({ maxRuntimeMinutes: 0 }));
    expect(result).not.toContain("Runtime:");
  });

  test("omits issue premise when issueIdentifier is absent", () => {
    const result = buildDynamicLoopBlock(makeCtx({ issueIdentifier: undefined }));
    expect(result).not.toContain("anchored to issue");
  });

  test("includes issue premise when issueIdentifier is present", () => {
    const result = buildDynamicLoopBlock(makeCtx({ issueIdentifier: "RLF-180" }));
    expect(result).toContain("RLF-180");
  });

  test("omits worktree premise when useWorktree is false", () => {
    const result = buildDynamicLoopBlock(
      makeCtx({ useWorktree: false, worktreePath: "/some/path" }),
    );
    expect(result).not.toContain("worktree root");
  });

  test("omits worktree premise when worktreePath is absent even if useWorktree is true", () => {
    const result = buildDynamicLoopBlock(makeCtx({ useWorktree: true, worktreePath: undefined }));
    expect(result).not.toContain("worktree root");
  });

  test("includes worktree premise when useWorktree true and worktreePath set", () => {
    const result = buildDynamicLoopBlock(
      makeCtx({ useWorktree: true, worktreePath: "/work/tree" }),
    );
    expect(result).toContain("/work/tree");
  });

  test("ci-fix premise present for pass=ci-fix", () => {
    const result = buildDynamicLoopBlock(makeCtx({ pass: "ci-fix" }));
    expect(result).toContain("ci-fix");
    expect(result).not.toContain("default orchestration");
  });

  test("normal-pass premise present for pass=normal", () => {
    const result = buildDynamicLoopBlock(makeCtx({ pass: "normal" }));
    expect(result).toContain("default orchestration");
    expect(result).not.toContain("ci-fix");
  });

  test("returns empty string when all caps are 0 and no optional fields", () => {
    const ctx = makeCtx({
      maxIterations: 0,
      maxCostUsd: 0,
      maxRuntimeMinutes: 0,
      confirmationEnabled: false,
      confirmationRound: 0,
      createPrOnSuccess: false,
      fixCiOnFailure: false,
      stackPrsOnDependencies: false,
      syncTasksToComment: false,
      useWorktree: false,
      worktreePath: undefined,
      issueIdentifier: undefined,
      issueUrl: undefined,
      pass: "normal",
    });
    // pass=normal still adds a paragraph
    expect(buildDynamicLoopBlock(ctx)).toContain("normal");
  });

  test("is fenced in --- delimiters when non-empty", () => {
    const result = buildDynamicLoopBlock(makeCtx());
    expect(result.startsWith("---\n")).toBe(true);
  });
});

describe("buildLoopLevelPrompt", () => {
  const mockState = {
    name: "test-change",
    iteration: 1,
    status: "active" as const,
    prompt: "",
    manualTest: false,
    createPr: false,
    prDraft: false,
    validateOnComplete: false,
    reviewRounds: 0,
    engine: "claude" as const,
    model: "claude-sonnet",
    lastModified: new Date().toISOString(),
    history: [],
    usage: {
      total_cost_usd: 0,
      total_duration_ms: 0,
      total_turns: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_read_input_tokens: 0,
      total_cache_creation_input_tokens: 0,
    },
  };

  test("preamble appears before stage block", () => {
    const ctx = makeCtx();
    const result = withCtx(() =>
      buildLoopLevelPrompt("execute", "implement", mockState, "/tmp/task", ctx),
    );
    const preambleIdx = result.indexOf("# Loop Context");
    const stageIdx = result.indexOf("# Stage:");
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(stageIdx).toBeGreaterThan(preambleIdx);
  });

  test("stage block appears before dynamic block", () => {
    const ctx = makeCtx({ maxIterations: 10 });
    const result = withCtx(() =>
      buildLoopLevelPrompt("execute", "implement", mockState, "/tmp/task", ctx),
    );
    const stageIdx = result.indexOf("# Stage:");
    const dynamicIdx = result.indexOf("# Dynamic Loop Context");
    expect(stageIdx).toBeGreaterThanOrEqual(0);
    expect(dynamicIdx).toBeGreaterThan(stageIdx);
  });

  test("dynamic block appears before phase prompt content", () => {
    const ctx = makeCtx({ maxIterations: 10 });
    const result = withCtx(() =>
      buildLoopLevelPrompt("execute", "implement", mockState, "/tmp/task", ctx),
    );
    const dynamicIdx = result.indexOf("# Dynamic Loop Context");
    const phaseIdx = result.indexOf("Change name:");
    expect(dynamicIdx).toBeGreaterThanOrEqual(0);
    expect(phaseIdx).toBeGreaterThan(dynamicIdx);
  });

  test("ci-fix premise present when pass=ci-fix", () => {
    const ctx = makeCtx({ pass: "ci-fix" });
    const result = withCtx(() =>
      buildLoopLevelPrompt("execute", "implement", mockState, "/tmp/task", ctx),
    );
    expect(result).toContain("ci-fix");
  });

  test("normal-pass premise present when pass=normal, no ci-fix premise", () => {
    const ctx = makeCtx({ pass: "normal" });
    const result = withCtx(() =>
      buildLoopLevelPrompt("execute", "implement", mockState, "/tmp/task", ctx),
    );
    expect(result).toContain("default orchestration");
    expect(result).not.toContain("CI diagnosis");
  });
});
