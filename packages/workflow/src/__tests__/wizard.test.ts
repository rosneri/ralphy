import { describe, test, expect } from "bun:test";
import { applyAnswersToWorkflow, buildWorkflowMarkdown, type WizardAnswers } from "../wizard";
import { parseWorkflow } from "../workflow";
import { DEFAULT_WORKFLOW_MD } from "../default";

/** Build markdown from answers and parse it back into a validated config. */
function roundTrip(answers: WizardAnswers) {
  const md = buildWorkflowMarkdown(answers);
  return { md, ...parseWorkflow(md) };
}

describe("buildWorkflowMarkdown", () => {
  test("output always round-trips through parseWorkflow", () => {
    const { config } = roundTrip({ mode: "quick" });
    // Untouched defaults survive.
    expect(config.engine).toBe("claude");
    expect(config.model).toBe("opus");
    expect(config.createPrOnSuccess).toBe(false);
  });

  test("preserves the template body and its comments", () => {
    const { md, body } = roundTrip({ mode: "quick", project: { name: "demo" } });
    expect(body).toContain("{{ issue.identifier }}");
    // Section dividers from the default are kept verbatim.
    expect(md).toContain("# ─── Engine ─");
    expect(md).toContain("meta_only_files:");
  });

  test("quick mode with no answers equals the default template", () => {
    expect(buildWorkflowMarkdown({ mode: "quick" })).toBe(DEFAULT_WORKFLOW_MD);
  });

  test("quick mode sets project name + linear identity only", () => {
    const { config } = roundTrip({
      mode: "quick",
      project: { name: "my-project" },
      linear: { team: "ENG", assignee: "me" },
    });
    expect(config.project.name).toBe("my-project");
    expect(config.linear.team).toBe("ENG");
    expect(config.linear.assignee).toBe("me");
    // Quick leaves flags at their defaults.
    expect(config.createPrOnSuccess).toBe(false);
    expect(config.fixCiOnFailure).toBe(false);
  });

  test("permissive mode flips PR/CI flags and disables manual merge", () => {
    const { config } = roundTrip({ mode: "permissive", project: { name: "p" } });
    expect(config.createPrOnSuccess).toBe(true);
    expect(config.fixCiOnFailure).toBe(true);
    expect(config.manualMergeWhenAutoMergeDisabled).toBe(false);
    expect(config.autoMergeStrategy).toBe("squash");
  });

  test("customized mode applies every collected scalar", () => {
    const { config } = roundTrip({
      mode: "customized",
      project: { name: "svc", language: "Go", framework: "gin" },
      commands: { test: "go test ./...", lint: "golangci-lint run" },
      engine: "codex",
      model: "sonnet",
      concurrency: 3,
      createPrOnSuccess: true,
      fixCiOnFailure: true,
      useWorktree: true,
      prBaseBranch: "develop",
    });
    expect(config.project).toEqual({ name: "svc", language: "Go", framework: "gin" });
    expect(config.commands.test).toBe("go test ./...");
    expect(config.commands.lint).toBe("golangci-lint run");
    expect(config.engine).toBe("codex");
    expect(config.model).toBe("sonnet");
    expect(config.concurrency).toBe(3);
    expect(config.createPrOnSuccess).toBe(true);
    expect(config.fixCiOnFailure).toBe(true);
    expect(config.useWorktree).toBe(true);
    expect(config.prBaseBranch).toBe("develop");
  });

  test("status-standard indicator preset produces a valid populated block", () => {
    const { config } = roundTrip({
      mode: "customized",
      linear: { team: "ENG", indicatorsPreset: "status-standard" },
    });
    const indicators = config.linear.indicators;
    expect(indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
    expect(indicators.getInProgress?.filter).toEqual([{ type: "status", value: "In Progress" }]);
    expect(indicators.setInProgress).toEqual({ type: "status", value: "In Progress" });
    expect(indicators.setDone).toEqual({ type: "status", value: "In Review" });
    expect(indicators.setError).toEqual({ type: "label", value: "ralph:error" });
  });

  test("label-standard indicator preset round-trips", () => {
    const { config } = roundTrip({
      mode: "customized",
      linear: { indicatorsPreset: "label-standard" },
    });
    expect(config.linear.indicators.getTodo?.filter).toEqual([
      { type: "label", value: "ralph:todo" },
    ]);
    expect(config.linear.indicators.setDone).toEqual({ type: "label", value: "ralph:done" });
  });

  test("none preset leaves indicators empty (no concrete block injected)", () => {
    const { config } = roundTrip({
      mode: "customized",
      linear: { team: "ENG", indicatorsPreset: "none" },
    });
    expect(config.linear.indicators).toEqual({});
  });

  test("values with YAML-special characters are quoted safely", () => {
    const { config } = roundTrip({
      mode: "customized",
      project: { name: "app: the sequel" },
      commands: { test: "bun test --filter '*: smoke'" },
      linear: { assignee: "dev@example.com" },
    });
    expect(config.project.name).toBe("app: the sequel");
    expect(config.commands.test).toBe("bun test --filter '*: smoke'");
    expect(config.linear.assignee).toBe("dev@example.com");
  });

  test("assignee without team still fills the linear block", () => {
    const { config } = roundTrip({ mode: "quick", linear: { assignee: "me" } });
    expect(config.linear.assignee).toBe("me");
    expect(config.linear.team).toBeUndefined();
  });
});

describe("applyAnswersToWorkflow (editing an existing file)", () => {
  test("changes only the answered keys and preserves everything else", () => {
    const existing = buildWorkflowMarkdown({
      mode: "customized",
      project: { name: "orig" },
      linear: { team: "ENG", indicatorsPreset: "status-standard" },
    });
    const updated = applyAnswersToWorkflow(existing, { mode: "customized", model: "sonnet" });
    const { config } = parseWorkflow(updated);
    expect(config.model).toBe("sonnet"); // changed
    expect(config.project.name).toBe("orig"); // preserved
    expect(config.linear.team).toBe("ENG"); // preserved
    // Existing indicators are preserved when no preset is re-chosen.
    expect(config.linear.indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
  });

  test("re-choosing an indicator preset overwrites the block", () => {
    const existing = buildWorkflowMarkdown({
      mode: "customized",
      linear: { indicatorsPreset: "status-standard" },
    });
    const updated = applyAnswersToWorkflow(existing, {
      mode: "customized",
      linear: { indicatorsPreset: "label-standard" },
    });
    const { config } = parseWorkflow(updated);
    expect(config.linear.indicators.getTodo?.filter).toEqual([
      { type: "label", value: "ralph:todo" },
    ]);
  });

  test("preserves unrelated body content", () => {
    const updated = applyAnswersToWorkflow(DEFAULT_WORKFLOW_MD, {
      mode: "customized",
      engine: "codex",
    });
    expect(updated).toContain("{{ issue.identifier }}");
    expect(parseWorkflow(updated).config.engine).toBe("codex");
  });
});
