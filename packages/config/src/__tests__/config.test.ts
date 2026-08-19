import { describe, expect, test } from "bun:test";
import { parseCommonArgv } from "@ralphy/cli-args";
import { WorkflowConfigSchema, parseWorkflow, DEFAULT_WORKFLOW_MD } from "@ralphy/workflow";
import { modelOptionValues } from "@ralphy/workflow/cli-options";
import {
  OVERRIDE_KEYS,
  OVERRIDE_TO_WORKFLOW_KEY,
  loopOptionsFromConfig,
  mergeConfig,
  resolveConfig,
  serializeAgentOverrides,
  serializeOverrides,
  type AgentOverrides,
  type CliOverrides,
  type ConfigFileSystem,
  type WorkflowConfig,
} from "../config";

const defaults = (): WorkflowConfig => WorkflowConfigSchema.parse({});

/** Map-backed ConfigFileSystem for the lifecycle tests — no disk, no Bun.file. */
function fakeFs(
  files: Record<string, string> = {},
): ConfigFileSystem & { files: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    async readText(path) {
      return map.get(path) ?? null;
    },
    async writeText(path, text) {
      map.set(path, text);
    },
  };
}

const changeStore = { archiveChange: async () => {} };

/** Read an effective value with the type widened for table-driven assertions. */
const valueAt = (cfg: WorkflowConfig, key: keyof WorkflowConfig): unknown => cfg[key];

/** One representative non-default value per override key, plus its workflow key/value. */
const PRECEDENCE_TABLE: {
  key: keyof CliOverrides;
  cliValue: unknown;
  /** The sparse override object a user passing `cliValue` would produce. */
  overrides: CliOverrides;
  workflowKey: keyof WorkflowConfig;
  workflowValue: unknown;
}[] = [
  {
    key: "engine",
    cliValue: "codex",
    overrides: { engine: "codex" },
    workflowKey: "engine",
    workflowValue: "codex",
  },
  {
    key: "model",
    cliValue: "haiku",
    overrides: { model: "haiku" },
    workflowKey: "model",
    workflowValue: "sonnet",
  },
  {
    key: "effort",
    cliValue: "xhigh",
    overrides: { effort: "xhigh" },
    workflowKey: "effort",
    workflowValue: "low",
  },
  {
    key: "maxIterations",
    cliValue: 7,
    overrides: { maxIterations: 7 },
    workflowKey: "maxIterationsPerTask",
    workflowValue: 11,
  },
  {
    key: "maxCostUsd",
    cliValue: 2.5,
    overrides: { maxCostUsd: 2.5 },
    workflowKey: "maxCostUsdPerTask",
    workflowValue: 9,
  },
  {
    key: "maxRuntimeMinutes",
    cliValue: 30,
    overrides: { maxRuntimeMinutes: 30 },
    workflowKey: "maxRuntimeMinutesPerTask",
    workflowValue: 60,
  },
  {
    key: "maxConsecutiveFailures",
    cliValue: 2,
    overrides: { maxConsecutiveFailures: 2 },
    workflowKey: "maxConsecutiveFailuresPerTask",
    workflowValue: 9,
  },
  {
    key: "delay",
    cliValue: 4,
    overrides: { delay: 4 },
    workflowKey: "iterationDelaySeconds",
    workflowValue: 8,
  },
  {
    key: "log",
    cliValue: true,
    overrides: { log: true },
    workflowKey: "logRawStream",
    workflowValue: false,
  },
  {
    key: "verbose",
    cliValue: true,
    overrides: { verbose: true },
    workflowKey: "taskVerbose",
    workflowValue: false,
  },
  {
    key: "manualTest",
    cliValue: true,
    overrides: { manualTest: true },
    workflowKey: "enableManualTest",
    workflowValue: false,
  },
  {
    // The negatable flag: WORKFLOW.md turns Tokenade on, `--no-tokenade` turns
    // it back off for this run. The CLI reaches only `enabled`, so the sibling
    // keys stay at their workflow values on both sides of the comparison.
    key: "tokenade",
    cliValue: { enabled: false, required: true, indexWorktrees: false },
    overrides: { tokenade: false },
    workflowKey: "tokenade",
    workflowValue: { enabled: true, required: true, indexWorktrees: false },
  },
];

describe("mergeConfig — precedence table", () => {
  test("cli > workflow > default for every override key, with the origin witness", () => {
    for (const row of PRECEDENCE_TABLE) {
      const workflow = WorkflowConfigSchema.parse({ [row.workflowKey]: row.workflowValue });
      const explicit = new Set<string>([row.workflowKey]);

      // default: nothing set anywhere
      const base = mergeConfig(defaults(), {});
      expect(valueAt(base.effective, row.workflowKey)).toEqual(
        valueAt(defaults(), row.workflowKey),
      );
      expect(base.origin.get(row.key)).toBe("default");

      // workflow beats default
      const fromWorkflow = mergeConfig(workflow, {}, explicit);
      expect(valueAt(fromWorkflow.effective, row.workflowKey)).toEqual(row.workflowValue);
      expect(fromWorkflow.origin.get(row.key)).toBe("workflow");

      // cli beats workflow
      const fromCli = mergeConfig(workflow, row.overrides, explicit);
      expect(valueAt(fromCli.effective, row.workflowKey)).toEqual(row.cliValue);
      expect(fromCli.origin.get(row.key)).toBe("cli");
    }
  });

  test("the precedence table covers every override key", () => {
    expect(PRECEDENCE_TABLE.map((r) => r.key).sort()).toEqual([...OVERRIDE_KEYS].sort());
    for (const row of PRECEDENCE_TABLE) {
      const mapped: string = OVERRIDE_TO_WORKFLOW_KEY[row.key];
      expect(mapped).toBe(row.workflowKey);
    }
  });

  test("a user explicitly passing the default value still wins as cli (the old sentinel bug)", () => {
    // WORKFLOW.md says 9 failures; the user explicitly passes the schema
    // default (5). The old `args.maxConsecutiveFailures !== 5` check made
    // this indistinguishable from "not passed" and fell through to 9.
    const workflow = WorkflowConfigSchema.parse({ maxConsecutiveFailuresPerTask: 9 });
    const merged = mergeConfig(
      workflow,
      { maxConsecutiveFailures: 5 },
      new Set(["maxConsecutiveFailuresPerTask"]),
    );
    expect(merged.effective.maxConsecutiveFailuresPerTask).toBe(5);
    expect(merged.origin.get("maxConsecutiveFailures")).toBe("cli");
  });

  test("an explicit zero override (--unlimited / --max-iterations 0) beats a workflow limit", () => {
    // `args.maxIterations || cfg.maxIterationsPerTask` lost explicit zeros.
    const workflow = WorkflowConfigSchema.parse({ maxIterationsPerTask: 10 });
    const merged = mergeConfig(workflow, { maxIterations: 0 }, new Set(["maxIterationsPerTask"]));
    expect(merged.effective.maxIterationsPerTask).toBe(0);
    expect(merged.origin.get("maxIterations")).toBe("cli");
  });

  test("an explicit false boolean override beats a workflow true", () => {
    const workflow = WorkflowConfigSchema.parse({ logRawStream: true });
    const merged = mergeConfig(workflow, { log: false }, new Set(["logRawStream"]));
    expect(merged.effective.logRawStream).toBe(false);
  });

  test("mergeConfig never mutates its inputs and passes non-override keys through", () => {
    const workflow = WorkflowConfigSchema.parse({ concurrency: 4, prBaseBranch: "develop" });
    const overrides: CliOverrides = { engine: "codex" };
    const { effective } = mergeConfig(workflow, overrides);
    expect(effective.concurrency).toBe(4);
    expect(effective.prBaseBranch).toBe("develop");
    expect(workflow.engine).toBe("claude");
    expect(overrides).toEqual({ engine: "codex" });
  });

  test("every schema model value survives the merge narrowing", () => {
    for (const model of modelOptionValues()) {
      const { effective } = mergeConfig(defaults(), { model });
      const merged: string = effective.model;
      expect(merged).toBe(model);
    }
  });
});

describe("mergeConfig — agent overrides (RLF-256)", () => {
  test("cli agent override beats workflow for each top-level agent key", () => {
    const workflow = WorkflowConfigSchema.parse({
      concurrency: 3,
      pollIntervalSeconds: 45,
      useWorktree: true,
      createPrOnSuccess: true,
      stackPrsOnDependencies: true,
    });
    const explicit = new Set([
      "concurrency",
      "pollIntervalSeconds",
      "useWorktree",
      "createPrOnSuccess",
      "stackPrsOnDependencies",
    ]);
    const agentOverrides: AgentOverrides = {
      concurrency: 7,
      pollInterval: 10,
      worktree: false,
      createPr: false,
      stackPrs: false,
    };
    const { effective, origin } = mergeConfig(workflow, {}, explicit, agentOverrides);
    expect(effective.concurrency).toBe(7);
    expect(effective.pollIntervalSeconds).toBe(10);
    expect(effective.useWorktree).toBe(false);
    expect(effective.createPrOnSuccess).toBe(false);
    expect(effective.stackPrsOnDependencies).toBe(false);
    expect(origin.get("concurrency")).toBe("cli");
    expect(origin.get("worktree")).toBe("cli");
  });

  test("unset agent override falls back to workflow then default", () => {
    const workflow = WorkflowConfigSchema.parse({ concurrency: 4 });
    const { effective, origin } = mergeConfig(workflow, {}, new Set(["concurrency"]), {});
    expect(effective.concurrency).toBe(4);
    expect(origin.get("concurrency")).toBe("workflow");

    const fromDefault = mergeConfig(defaults(), {}, new Set(), {});
    expect(fromDefault.effective.concurrency).toBe(defaults().concurrency);
    expect(fromDefault.origin.get("concurrency")).toBe("default");
  });

  test("the two nested linear.* overrides merge once, preserving sibling linear fields", () => {
    const workflow = WorkflowConfigSchema.parse({});
    const originalTeam = workflow.linear.team;
    const agentOverrides: AgentOverrides = { linearTeam: "ENG", codeReview: false };
    const { effective, origin } = mergeConfig(workflow, {}, new Set(["linear"]), agentOverrides);
    expect(effective.linear.team).toBe("ENG");
    expect(effective.linear.codeReviewTrigger).toBe(false);
    // Sibling fields on `linear` survive the rebuild (not clobbered).
    expect(effective.linear.filter).toEqual(workflow.linear.filter);
    expect(effective.linear.indicators).toEqual(workflow.linear.indicators);
    expect(origin.get("linearTeam")).toBe("cli");
    expect(origin.get("codeReview")).toBe("cli");
    // Input not mutated.
    expect(workflow.linear.team).toBe(originalTeam);
  });

  test("an explicit --concurrency 0 resolves differently than an unset concurrency (E1)", () => {
    const workflow = WorkflowConfigSchema.parse({ concurrency: 5 });
    const present = mergeConfig(workflow, {}, new Set(["concurrency"]), { concurrency: 0 });
    const unset = mergeConfig(workflow, {}, new Set(["concurrency"]), {});
    expect(present.effective.concurrency).toBe(0);
    expect(unset.effective.concurrency).toBe(5);
    expect(present.effective.concurrency).not.toBe(unset.effective.concurrency);
  });

  test("loop boot is byte-identical when agentOverrides is {} (E6)", () => {
    // The loop never passes agentOverrides. Its effective config must equal the
    // pre-RLF-256 behavior: every agent-controlled field equals the workflow's,
    // and the `linear` container is structurally preserved.
    const workflow = WorkflowConfigSchema.parse({
      concurrency: 3,
      pollIntervalSeconds: 45,
      useWorktree: true,
      createPrOnSuccess: true,
      stackPrsOnDependencies: true,
    });
    const withEmpty = mergeConfig(workflow, {}, new Set()).effective;
    const withExplicitEmpty = mergeConfig(workflow, {}, new Set(), {}).effective;
    expect(withEmpty).toEqual(withExplicitEmpty);
    expect(withEmpty.concurrency).toBe(workflow.concurrency);
    expect(withEmpty.pollIntervalSeconds).toBe(workflow.pollIntervalSeconds);
    expect(withEmpty.useWorktree).toBe(workflow.useWorktree);
    expect(withEmpty.createPrOnSuccess).toBe(workflow.createPrOnSuccess);
    expect(withEmpty.stackPrsOnDependencies).toBe(workflow.stackPrsOnDependencies);
    expect(withEmpty.linear).toEqual(workflow.linear);
  });
});

describe("serializeAgentOverrides — parent/child round-trip", () => {
  test("empty agent overrides serialize to an empty argv", () => {
    expect(serializeAgentOverrides({})).toEqual([]);
  });

  test("each agent override key serializes to its flag", () => {
    expect(
      serializeAgentOverrides({
        concurrency: 4,
        pollInterval: 30,
        linearTeam: "ENG",
        worktree: true,
        createPr: true,
        stackPrs: true,
        codeReview: true,
      }),
    ).toEqual([
      "--concurrency",
      "4",
      "--poll-interval",
      "30",
      "--linear-team",
      "ENG",
      "--worktree",
      "--create-pr",
      "--stack-prs",
      "--code-review",
    ]);
  });

  test("an explicit --concurrency 0 survives serialization (E1/E4)", () => {
    expect(serializeAgentOverrides({ concurrency: 0 })).toEqual(["--concurrency", "0"]);
  });
});

describe("serializeOverrides — parent/child round-trip", () => {
  test("re-parsing serialized overrides yields the identical sparse object", async () => {
    const overrides: CliOverrides = {
      engine: "codex",
      model: "sonnet",
      maxIterations: 12,
      maxCostUsd: 2.5,
      maxRuntimeMinutes: 90,
      maxConsecutiveFailures: 3,
      delay: 7,
      log: true,
      verbose: true,
      manualTest: true,
      tokenade: true,
    };
    const argv = serializeOverrides(overrides);
    const { args, rest } = await parseCommonArgv(argv);
    expect(rest).toEqual([]);
    expect(args.overrides).toEqual(overrides);
  });

  test("empty overrides serialize to an empty argv", () => {
    expect(serializeOverrides({})).toEqual([]);
  });

  test("an explicit tokenade:false serializes to --no-tokenade and survives the round-trip", async () => {
    // A truthiness check here would drop the override and let the child
    // re-enable Tokenade from WORKFLOW.md — the parent said no.
    const argv = serializeOverrides({ tokenade: false });
    expect(argv).toEqual(["--no-tokenade"]);
    const { args } = await parseCommonArgv(argv);
    expect(args.overrides.tokenade).toBe(false);
  });

  test("an explicit zero limit survives the round-trip", async () => {
    const argv = serializeOverrides({ maxIterations: 0 });
    expect(argv).toEqual(["--max-iterations", "0"]);
    const { args } = await parseCommonArgv(argv);
    expect(args.overrides.maxIterations).toBe(0);
  });

  test("--claude followed by --model does not eat the flag as a model token", async () => {
    const argv = serializeOverrides({ engine: "claude", model: "sonnet" });
    const { args } = await parseCommonArgv(argv);
    expect(args.overrides).toEqual({ engine: "claude", model: "sonnet" });
  });

  test("round-trip through resolveConfig yields the parent's effective values", async () => {
    const fs = fakeFs({
      "/proj/WORKFLOW.md": `---\nmodel: sonnet\nmaxIterationsPerTask: 11\n---\nbody\n`,
    });
    const parent = await resolveConfig({
      argv: ["--max-iterations", "5", "--codex"],
      projectRoot: "/proj",
      fileSystem: fs,
    });
    const child = await resolveConfig({
      argv: [...serializeOverrides(parent.overrides), "--from-agent"],
      projectRoot: "/proj",
      fileSystem: fs,
    });
    expect(child.effective).toEqual(parent.effective);
    expect(child.cli.fromAgent).toBe(true);
  });
});

describe("resolveConfig — WORKFLOW.md lifecycle", () => {
  test("missing file falls back to the default template (pure defaults, all origins default)", async () => {
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fakeFs() });
    expect(resolved.workflowPath).toBe("/proj/WORKFLOW.md");
    expect(resolved.effective).toEqual(parseWorkflow(DEFAULT_WORKFLOW_MD).config);
    for (const key of OVERRIDE_KEYS) expect(resolved.origin(key)).toBe("default");
  });

  test("snapshot: resolveConfig({argv: []}) pins today's defaults", async () => {
    const { effective } = await resolveConfig({
      argv: [],
      projectRoot: "/proj",
      fileSystem: fakeFs(),
    });
    expect(effective.engine).toBe("claude");
    expect(effective.model).toBe("opus");
    expect(effective.maxIterationsPerTask).toBe(0);
    expect(effective.maxCostUsdPerTask).toBe(0);
    expect(effective.maxRuntimeMinutesPerTask).toBe(0);
    expect(effective.maxConsecutiveFailuresPerTask).toBe(5);
    expect(effective.iterationDelaySeconds).toBe(0);
    expect(effective.logRawStream).toBe(true);
    expect(effective.taskVerbose).toBe(false);
    expect(effective.enableManualTest).toBe(false);
    expect(effective.concurrency).toBe(1);
    expect(effective.prBaseBranch).toBe("main");
    expect(effective.createPrOnSuccess).toBe(false);
  });

  test("workflow values apply and report workflow origin; untouched keys stay default", async () => {
    const fs = fakeFs({
      "/proj/WORKFLOW.md": `---\nengine: codex\nmaxConsecutiveFailuresPerTask: 5\n---\n`,
    });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    expect(resolved.effective.engine).toBe("codex");
    expect(resolved.origin("engine")).toBe("workflow");
    // Explicitly written AT the default value still counts as workflow-origin:
    // presence carries intent.
    expect(resolved.origin("maxConsecutiveFailures")).toBe("workflow");
    expect(resolved.origin("model")).toBe("default");
  });

  test("normalize's defaults backfill is NOT misattributed as workflow origin", async () => {
    // The in-memory self-heal materializes every default-bearing key before
    // parse; the witness must come from the pre-normalize text.
    const fs = fakeFs({ "/proj/WORKFLOW.md": `---\nproject:\n  name: demo\n---\n` });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    for (const key of ["engine", "model", "maxIterations", "log"] as const) {
      expect(resolved.origin(key)).toBe("default");
    }
  });

  test("alias blocks fold into the witness: agent.engine counts as workflow-set engine", async () => {
    const fs = fakeFs({ "/proj/WORKFLOW.md": `---\nagent:\n  engine: codex\n---\n` });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    expect(resolved.effective.engine).toBe("codex");
    expect(resolved.origin("engine")).toBe("workflow");
  });

  test("cli overrides beat workflow values end to end", async () => {
    const fs = fakeFs({
      "/proj/WORKFLOW.md": `---\nengine: codex\nmodel: sonnet\nmaxIterationsPerTask: 11\n---\n`,
    });
    const resolved = await resolveConfig({
      argv: ["--claude", "haiku", "--unlimited"],
      projectRoot: "/proj",
      fileSystem: fs,
    });
    expect(resolved.effective.engine).toBe("claude");
    expect(resolved.effective.model).toBe("haiku");
    expect(resolved.effective.maxIterationsPerTask).toBe(0);
    expect(resolved.origin("engine")).toBe("cli");
    expect(resolved.origin("maxIterations")).toBe("cli");
  });

  test("commands.structure resolves to the schema default when WORKFLOW.md omits it", async () => {
    // The in-loop structural gate is on by default — a file that names no
    // `structure` command still resolves to `bun run check:structure`.
    const fs = fakeFs({ "/proj/WORKFLOW.md": `---\ncommands:\n  test: bun test\n---\n` });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    expect(resolved.effective.commands.structure).toBe("bun run check:structure");
  });

  test("commands.structure honors a WORKFLOW.md override", async () => {
    // No `args.x || cfg.y` merge logic: the resolved value is exactly what the
    // file declares (here, an opt-out via the empty string).
    const fs = fakeFs({
      "/proj/WORKFLOW.md": `---\ncommands:\n  test: bun test\n  structure: ""\n---\n`,
    });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    expect(resolved.effective.commands.structure).toBe("");
  });

  test("--workflow resolves against --project-root regardless of flag order", async () => {
    const fs = fakeFs({ "/proj/config/ALT.md": `---\nmodel: haiku\n---\n` });
    const resolved = await resolveConfig({
      argv: ["--workflow", "config/ALT.md", "--project-root", "/proj"],
      fileSystem: fs,
    });
    expect(resolved.workflowPath).toBe("/proj/config/ALT.md");
    expect(resolved.effective.model).toBe("haiku");
  });

  test("an explicit projectRoot input is the fallback when --project-root is absent", async () => {
    const fs = fakeFs({ "/cwd/WORKFLOW.md": `---\nmodel: sonnet\n---\n` });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/cwd", fileSystem: fs });
    expect(resolved.effective.model).toBe("sonnet");
    expect(resolved.cli.projectRoot).toBeUndefined();
  });

  test("throws without any project root", async () => {
    expect(resolveConfig({ argv: [], fileSystem: fakeFs() })).rejects.toThrow("projectRoot");
  });

  test("--prompt-file reads through the injected file system", async () => {
    const fs = fakeFs({ "/proj/p.txt": "prompt from file" });
    const resolved = await resolveConfig({
      argv: ["--prompt-file", "/proj/p.txt"],
      projectRoot: "/proj",
      fileSystem: fs,
    });
    expect(resolved.cli.prompt).toBe("prompt from file");
  });

  test("app-bespoke tokens on argv are skipped, not errors", async () => {
    const resolved = await resolveConfig({
      argv: ["task", "--worktree", "--max-iterations", "3"],
      projectRoot: "/proj",
      fileSystem: fakeFs(),
    });
    expect(resolved.overrides).toEqual({ maxIterations: 3 });
  });
});

describe("loopOptions — config/runtime split", () => {
  test("config-derived fields come from effective; runtime fields from the caller", async () => {
    const fs = fakeFs({
      "/proj/WORKFLOW.md": `---\nengine: codex\nmodel: sonnet\nmaxIterationsPerTask: 9\niterationDelaySeconds: 3\ntaskVerbose: true\nenableManualTest: true\n---\n`,
    });
    const resolved = await resolveConfig({ argv: [], projectRoot: "/proj", fileSystem: fs });
    const opts = resolved.loopOptions({
      name: "rlf-1",
      prompt: "do it",
      changeStore,
      phase: "execute",
      createPr: true,
    });
    expect(opts).toMatchObject({
      name: "rlf-1",
      prompt: "do it",
      engine: "codex",
      model: "sonnet",
      maxIterations: 9,
      delay: 3,
      verbose: true,
      manualTest: true,
      createPr: true,
      phase: "execute",
    });
    expect(opts.changeStore).toBe(changeStore);
    expect(opts.reviewPhase).toBeUndefined();
  });

  test("the workflow's openspec.reviewPhase flows into LoopOptions when enabled", () => {
    const effective = WorkflowConfigSchema.parse({
      openspec: {
        reviewPhase: {
          enabled: true,
          maxRounds: 2,
          reviewerModel: "haiku",
          reviewerContextStrategy: "warm",
        },
      },
    });
    const opts = loopOptionsFromConfig(effective, { name: "x", prompt: "", changeStore });
    expect(opts.reviewPhase).toEqual({
      enabled: true,
      maxRounds: 2,
      reviewerModel: "haiku",
      reviewerContextStrategy: "warm",
    });
  });

  test("sparse --review-* overrides overlay the workflow block (cli > workflow)", () => {
    const effective = WorkflowConfigSchema.parse({
      openspec: {
        reviewPhase: { enabled: true, maxRounds: 2, reviewerContextStrategy: "warm" },
      },
    });
    const opts = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      reviewPhase: { maxRounds: 5 },
    });
    // Overridden key wins; untouched keys keep their workflow values.
    expect(opts.reviewPhase).toEqual({
      enabled: true,
      maxRounds: 5,
      reviewerContextStrategy: "warm",
    });
  });

  test("--review-enabled turns the phase on even when the workflow leaves it off", () => {
    const effective = WorkflowConfigSchema.parse({});
    const opts = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      reviewPhase: { enabled: true, reviewerModel: "haiku" },
    });
    expect(opts.reviewPhase).toEqual({
      enabled: true,
      maxRounds: 1,
      reviewerContextStrategy: "fresh",
      reviewerModel: "haiku",
    });
  });

  test("review value flags without --review-enabled leave the phase off", () => {
    const effective = WorkflowConfigSchema.parse({});
    const opts = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      reviewPhase: { maxRounds: 3 },
    });
    expect(opts.reviewPhase).toBeUndefined();
  });

  test("top-level effort flows into LoopOptions; unset stays absent", () => {
    const withEffort = WorkflowConfigSchema.parse({ effort: "xhigh" });
    expect(loopOptionsFromConfig(withEffort, { name: "x", prompt: "", changeStore }).effort).toBe(
      "xhigh",
    );
    const without = WorkflowConfigSchema.parse({});
    expect(
      loopOptionsFromConfig(without, { name: "x", prompt: "", changeStore }).effort,
    ).toBeUndefined();
  });

  test("planModel/planEffort flow into LoopOptions; unset stays absent", () => {
    const withPlan = WorkflowConfigSchema.parse({ planModel: "sonnet", planEffort: "high" });
    const opts = loopOptionsFromConfig(withPlan, { name: "x", prompt: "", changeStore });
    expect(opts.planModel).toBe("sonnet");
    expect(opts.planEffort).toBe("high");
    const without = loopOptionsFromConfig(WorkflowConfigSchema.parse({}), {
      name: "x",
      prompt: "",
      changeStore,
    });
    expect(without.planModel).toBeUndefined();
    expect(without.planEffort).toBeUndefined();
  });

  test("reviewerEffort flows into reviewPhase, overridable via --review-effort", () => {
    const effective = WorkflowConfigSchema.parse({
      openspec: { reviewPhase: { enabled: true, reviewerEffort: "high" } },
    });
    const fromWorkflow = loopOptionsFromConfig(effective, { name: "x", prompt: "", changeStore });
    expect(fromWorkflow.reviewPhase?.reviewerEffort).toBe("high");
    const fromCli = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      reviewPhase: { reviewerEffort: "low" },
    });
    expect(fromCli.reviewPhase?.reviewerEffort).toBe("low");
  });

  test("--trigger ci-fix selects prRecovery.ciFix{Model,Effort} with top-level fallback", () => {
    const effective = WorkflowConfigSchema.parse({
      model: "fable",
      effort: "xhigh",
      prRecovery: { ciFixModel: "sonnet", ciFixEffort: "low" },
    });
    const ciFix = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      trigger: "ci-fix",
    });
    expect(ciFix.model).toBe("sonnet");
    expect(ciFix.effort).toBe("low");
    // conflict-fix keys unset → falls back to the top-level model/effort.
    const conflictFix = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      trigger: "conflict-fix",
    });
    expect(conflictFix.model).toBe("fable");
    expect(conflictFix.effort).toBe("xhigh");
    // No trigger → top-level values untouched by the prRecovery keys.
    const regular = loopOptionsFromConfig(effective, { name: "x", prompt: "", changeStore });
    expect(regular.model).toBe("fable");
    expect(regular.effort).toBe("xhigh");
  });

  test("--trigger conflict-fix selects prRecovery.conflictFix{Model,Effort}", () => {
    const effective = WorkflowConfigSchema.parse({
      prRecovery: { conflictFixModel: "haiku", conflictFixEffort: "medium" },
    });
    const opts = loopOptionsFromConfig(effective, {
      name: "x",
      prompt: "",
      changeStore,
      trigger: "conflict-fix",
    });
    expect(opts.model).toBe("haiku");
    expect(opts.effort).toBe("medium");
  });
});

describe("resolveConfig — default Bun-backed file system", () => {
  test("reads a real WORKFLOW.md from disk when no fileSystem is injected", async () => {
    const dir = await import("node:fs/promises").then(async (fs) => {
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      return fs.mkdtemp(join(tmpdir(), "ralphy-config-"));
    });
    try {
      await Bun.write(`${dir}/WORKFLOW.md`, `---\nmodel: haiku\n---\nbody\n`);
      const resolved = await resolveConfig({ argv: [], projectRoot: dir });
      expect(resolved.effective.model).toBe("haiku");
      // A missing file on the real fs falls back to defaults, not an error.
      const missing = await resolveConfig({ argv: [], projectRoot: `${dir}/nope` });
      expect(missing.effective.model).toBe("opus");
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing --prompt-file throws with the path attached", async () => {
    const err = await resolveConfig({
      argv: ["--prompt-file", "/proj/missing.txt"],
      projectRoot: "/proj",
      fileSystem: fakeFs(),
    }).then(
      () => null,
      (e: Error & { path?: string }) => e,
    );
    expect(err?.message).toBe("--prompt-file not found");
    expect(err?.path).toBe("/proj/missing.txt");
  });
});

describe("mergeConfig — tokenade", () => {
  test("--tokenade flips only `enabled`, leaving the rest of the block alone", () => {
    const workflow = WorkflowConfigSchema.parse({
      tokenade: { enabled: false, required: true, indexWorktrees: false, readMode: "reference" },
    });
    const merged = mergeConfig(workflow, { tokenade: true }, new Set(["tokenade"]));
    expect(merged.effective.tokenade).toEqual({
      enabled: true,
      required: true,
      indexWorktrees: false,
      readMode: "reference",
    });
    expect(merged.origin.get("tokenade")).toBe("cli");
  });

  test("defaults to off, non-fatal, warming worktrees", () => {
    expect(defaults().tokenade).toEqual({
      enabled: false,
      required: false,
      indexWorktrees: true,
    });
  });
});
