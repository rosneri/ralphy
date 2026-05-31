import { describe, test, expect } from "bun:test";
import {
  applyAnswersToWorkflow,
  buildWorkflowMarkdown,
  indicatorsForPreset,
  type WizardAnswers,
  type WizardValue,
} from "../wizard";
import { parseWorkflow } from "../workflow";
import { DEFAULT_WORKFLOW_MD } from "../default";

function roundTrip(mode: WizardAnswers["mode"], values: Record<string, WizardValue> = {}) {
  const md = buildWorkflowMarkdown({ mode, values });
  return { md, ...parseWorkflow(md) };
}

describe("buildWorkflowMarkdown", () => {
  test("quick mode with no answers is byte-identical to the default template", () => {
    expect(buildWorkflowMarkdown({ mode: "quick", values: {} })).toBe(DEFAULT_WORKFLOW_MD);
  });

  test("output always round-trips through parseWorkflow", () => {
    const { config } = roundTrip("quick");
    expect(config.engine).toBe("claude");
    expect(config.model).toBe("opus");
    expect(config.createPrOnSuccess).toBe(false);
  });

  test("preserves the template body and comments", () => {
    const { md, body } = roundTrip("quick", { "project.name": "demo" });
    expect(body).toContain("{{ issue.identifier }}");
    expect(md).toContain("# ─── Engine ─");
    expect(md).toContain("meta_only_files:");
  });

  test("quick mode sets project name + linear identity", () => {
    const { config } = roundTrip("quick", {
      "project.name": "my-project",
      "linear.team": "ENG",
      "linear.assignee": "me",
    });
    expect(config.project.name).toBe("my-project");
    expect(config.linear.team).toBe("ENG");
    expect(config.linear.assignee).toBe("me");
    expect(config.createPrOnSuccess).toBe(false);
  });

  test("permissive mode flips PR/CI flags and disables manual merge", () => {
    const { config } = roundTrip("permissive", { "project.name": "p" });
    expect(config.createPrOnSuccess).toBe(true);
    expect(config.fixCiOnFailure).toBe(true);
    expect(config.manualMergeWhenAutoMergeDisabled).toBe(false);
  });

  test("customized mode applies scalars across every group", () => {
    const { config } = roundTrip("customized", {
      "project.name": "svc",
      "commands.test": "go test ./...",
      engine: "codex",
      model: "sonnet",
      concurrency: 3,
      maxIterationsPerTask: 20,
      maxCostUsdPerTask: 5,
      createPrOnSuccess: true,
      prDraft: true,
      stackPrsOnDependencies: true,
      autoMergeStrategy: "rebase",
      fixCiOnFailure: true,
      maxCiFixAttempts: 8,
      useWorktree: true,
      prBaseBranch: "develop",
    });
    expect(config.project.name).toBe("svc");
    expect(config.commands.test).toBe("go test ./...");
    expect(config.engine).toBe("codex");
    expect(config.model).toBe("sonnet");
    expect(config.concurrency).toBe(3);
    expect(config.maxIterationsPerTask).toBe(20);
    expect(config.maxCostUsdPerTask).toBe(5);
    expect(config.prDraft).toBe(true);
    expect(config.stackPrsOnDependencies).toBe(true);
    expect(config.autoMergeStrategy).toBe("rebase");
    expect(config.maxCiFixAttempts).toBe(8);
    expect(config.useWorktree).toBe(true);
    expect(config.prBaseBranch).toBe("develop");
  });

  test("list fields round-trip as YAML sequences", () => {
    const { config } = roundTrip("customized", {
      rules: ["never break the build", "small commits"],
      ignoreCiChecks: ["flaky-e2e"],
      "boundaries.never_touch": ["dist/**", "vendor/**"],
      "linear.specAttachmentFormats": ["md", "pdf"],
    });
    expect(config.rules).toEqual(["never break the build", "small commits"]);
    expect(config.ignoreCiChecks).toEqual(["flaky-e2e"]);
    expect(config.boundaries.never_touch).toEqual(["dist/**", "vendor/**"]);
    expect(config.linear.specAttachmentFormats).toEqual(["md", "pdf"]);
  });

  test("nested object fields (confirmation mode, gates) round-trip", () => {
    const { config } = roundTrip("customized", {
      "linear.confirmationMode.enabled": true,
      "linear.confirmationMode.timeoutHours": 24,
      "linear.confirmationMode.maxConfirmationRounds": 2,
      "preExistingErrorCheck.enabled": true,
      "preExistingErrorCheck.baseBranch": "develop",
      "prTracker.advanceMergedToDone": true,
      "openspec.reviewPhase.enabled": true,
      "openspec.reviewPhase.maxRounds": 2,
    });
    expect(config.linear.confirmationMode.enabled).toBe(true);
    expect(config.linear.confirmationMode.timeoutHours).toBe(24);
    expect(config.linear.confirmationMode.maxConfirmationRounds).toBe(2);
    expect(config.preExistingErrorCheck.enabled).toBe(true);
    expect(config.preExistingErrorCheck.baseBranch).toBe("develop");
    expect(config.prTracker.advanceMergedToDone).toBe(true);
    expect(config.openspec.reviewPhase.enabled).toBe(true);
    expect(config.openspec.reviewPhase.maxRounds).toBe(2);
  });

  test("indicator preset round-trips", () => {
    const { config } = roundTrip("customized", {
      "linear.indicators": indicatorsForPreset("status-standard"),
    });
    expect(config.linear.indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
    expect(config.linear.indicators.setDone).toEqual({ type: "status", value: "In Review" });
  });

  test("custom indicators with set/clear slots satisfy the marker constraints", () => {
    const { config } = roundTrip("customized", {
      "linear.indicators": {
        getTodo: { filter: [{ type: "status", value: "Todo" }] },
        setInProgress: { type: "status", value: "Doing" },
        setError: { type: "label", value: "ralph:error" },
        getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
        clearApproved: { type: "label", value: "ralph:approved" },
      },
    });
    expect(config.linear.indicators.setInProgress).toEqual({ type: "status", value: "Doing" });
    expect(config.linear.indicators.clearApproved).toEqual({
      type: "label",
      value: "ralph:approved",
    });
  });

  test("values with YAML-special characters are quoted safely", () => {
    const { config } = roundTrip("customized", {
      "project.name": "app: the sequel",
      "commands.test": "bun test --filter '*: smoke'",
      "linear.assignee": "dev@example.com",
    });
    expect(config.project.name).toBe("app: the sequel");
    expect(config.commands.test).toBe("bun test --filter '*: smoke'");
    expect(config.linear.assignee).toBe("dev@example.com");
  });
});

describe("applyAnswersToWorkflow (editing an existing file)", () => {
  test("changes only the answered keys and preserves everything else", () => {
    const existing = buildWorkflowMarkdown({
      mode: "customized",
      values: {
        "project.name": "orig",
        "linear.team": "ENG",
        "linear.indicators": indicatorsForPreset("status-standard"),
      },
    });
    const updated = applyAnswersToWorkflow(existing, {
      mode: "customized",
      values: { model: "sonnet" },
    });
    const { config } = parseWorkflow(updated);
    expect(config.model).toBe("sonnet");
    expect(config.project.name).toBe("orig");
    expect(config.linear.team).toBe("ENG");
    expect(config.linear.indicators.getTodo?.filter).toEqual([{ type: "status", value: "Todo" }]);
  });

  test("re-choosing indicators overwrites the block", () => {
    const existing = buildWorkflowMarkdown({
      mode: "customized",
      values: { "linear.indicators": indicatorsForPreset("status-standard") },
    });
    const updated = applyAnswersToWorkflow(existing, {
      mode: "customized",
      values: { "linear.indicators": indicatorsForPreset("label-standard") },
    });
    expect(parseWorkflow(updated).config.linear.indicators.getTodo?.filter).toEqual([
      { type: "label", value: "ralph:todo" },
    ]);
  });

  test("preserves unrelated body content", () => {
    const updated = applyAnswersToWorkflow(DEFAULT_WORKFLOW_MD, {
      mode: "customized",
      values: { engine: "codex" },
    });
    expect(updated).toContain("{{ issue.identifier }}");
    expect(parseWorkflow(updated).config.engine).toBe("codex");
  });
});
