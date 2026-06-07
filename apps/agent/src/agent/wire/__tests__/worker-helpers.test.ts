import { describe, expect, test } from "bun:test";
import { WorkflowConfigSchema } from "@ralphy/workflow";
import {
  buildPostTaskInput,
  buildTaskCmd,
  computeWantPr,
  computeWantValidateOnly,
  releaseWorkerMaps,
  type WorkerChangeMaps,
} from "../spawn/worker";
import { parseAgentArgs } from "../../../cli";
import type { AgentParsedArgs } from "../../../cli";
import type { RalphyConfig } from "../../config";
import type { LinearIssue } from "../../linear";

const baseArgs = (): Promise<AgentParsedArgs> => parseAgentArgs([]);
const baseCfg = (o: Record<string, unknown> = {}): RalphyConfig => WorkflowConfigSchema.parse(o);

// Pure decisions extracted from the spawn-worker exit handler, asserted
// without constructing the closure (the release-maps.ts pattern).

describe("buildTaskCmd", () => {
  test("emits the loop task argv terminated by --from-agent", async () => {
    const cmd = buildTaskCmd(await baseArgs(), baseCfg(), "rlf-1");
    expect(cmd.slice(2, 7)).toEqual(["loop", "task", "--name", "rlf-1", "--claude"]);
    expect(cmd[cmd.length - 1]).toBe("--from-agent");
  });

  test("passes the model via the explicit --model flag, never positionally", async () => {
    const cmd = buildTaskCmd(await baseArgs(), baseCfg(), "rlf-1");
    const engineIdx = cmd.indexOf("--claude");
    // The token right after the engine flag must be `--model`, not a bare name.
    expect(cmd[engineIdx + 1]).toBe("--model");
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("opus");
  });

  test("uses CLI engine/model when engineSet, else config values", async () => {
    const args = await baseArgs();
    args.engineSet = true;
    args.engine = "codex";
    args.model = "sonnet";
    const cmd = buildTaskCmd(args, baseCfg({ engine: "claude", model: "opus" }), "rlf-1");
    expect(cmd).toContain("--codex");
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("sonnet");

    const fallback = buildTaskCmd(
      await baseArgs(),
      baseCfg({ engine: "codex", model: "sonnet" }),
      "rlf-1",
    );
    expect(fallback).toContain("--codex");
    expect(fallback[fallback.indexOf("--model") + 1]).toBe("sonnet");
  });

  test("adds limit flags only when set", async () => {
    const args = await baseArgs();
    args.maxIterations = 7;
    args.maxCostUsd = 3.5;
    args.maxRuntimeMinutes = 42;
    args.delay = 9;
    const cmd = buildTaskCmd(args, baseCfg(), "rlf-1");
    expect(cmd[cmd.indexOf("--max-iterations") + 1]).toBe("7");
    expect(cmd[cmd.indexOf("--max-cost") + 1]).toBe("3.5");
    expect(cmd[cmd.indexOf("--max-runtime") + 1]).toBe("42");
    expect(cmd[cmd.indexOf("--delay") + 1]).toBe("9");
  });

  test("omits --max-failures at the default 5, includes it when overridden", async () => {
    const def = await baseArgs();
    def.maxConsecutiveFailures = 5;
    expect(buildTaskCmd(def, baseCfg({ maxConsecutiveFailuresPerTask: 5 }), "rlf-1")).not.toContain(
      "--max-failures",
    );

    const over = await baseArgs();
    over.maxConsecutiveFailures = 2;
    const cmd = buildTaskCmd(over, baseCfg(), "rlf-1");
    expect(cmd[cmd.indexOf("--max-failures") + 1]).toBe("2");
  });

  test("wires review-phase flags only when the review phase is enabled", async () => {
    const args = await baseArgs();
    expect(buildTaskCmd(args, baseCfg(), "rlf-1")).not.toContain("--review-enabled");

    const cmd = buildTaskCmd(
      args,
      baseCfg({
        openspec: {
          reviewPhase: {
            enabled: true,
            maxRounds: 3,
            reviewerModel: "sonnet",
            reviewerContextStrategy: "warm",
          },
        },
      }),
      "rlf-1",
    );
    expect(cmd).toContain("--review-enabled");
    expect(cmd[cmd.indexOf("--review-max-rounds") + 1]).toBe("3");
    expect(cmd[cmd.indexOf("--review-model") + 1]).toBe("sonnet");
    expect(cmd[cmd.indexOf("--review-context-strategy") + 1]).toBe("warm");
  });
});

describe("buildPostTaskInput", () => {
  async function build(extra: Record<string, unknown> = {}) {
    const args = await baseArgs();
    const cfg = baseCfg({
      teardownScript: "make clean",
      commands: { test: "bun test", lint: "bun lint", typecheck: "" },
    });
    return buildPostTaskInput({
      args,
      cfg,
      changeName: "rlf-1",
      cwd: "/work",
      projectRoot: "/root",
      changeDir: "/root/openspec/changes/rlf-1",
      stateFilePath: "/states/rlf-1/.ralph-state.json",
      branch: "feat/rlf-1",
      issue: null,
      exitCode: 0,
      useWorktree: true,
      wantPr: true,
      wantAutoMerge: false,
      wantValidateOnly: false,
      respawnWorker: async () => 0,
      ...extra,
    });
  }

  test("maps the cfg block, dropping falsy validate commands", async () => {
    const input = await build();
    expect(input.cfg.teardownScript).toBe("make clean");
    // typecheck is "" so it is filtered out of validateCommands.
    expect(input.cfg.validateCommands).toEqual(["bun test", "bun lint"]);
    expect(input.changeName).toBe("rlf-1");
    expect(input.branch).toBe("feat/rlf-1");
    expect(input.wantPr).toBe(true);
  });

  test("omits mode and prUrl keys unless supplied", async () => {
    const input = await build();
    expect("mode" in input).toBe(false);
    expect("prUrl" in input).toBe(false);
  });

  test("includes mode from the trigger and an explicit prUrl", async () => {
    const input = await build({ trigger: "conflict-fix", prUrl: "https://x/pull/1" });
    expect(input.mode).toBe("conflict-fix");
    expect(input.prUrl).toBe("https://x/pull/1");
  });

  test("propagates the stackPrs CLI override into cfg", async () => {
    const args = await baseArgs();
    args.stackPrs = true;
    const input = buildPostTaskInput({
      args,
      cfg: baseCfg(),
      changeName: "rlf-1",
      cwd: "/work",
      projectRoot: "/root",
      changeDir: "/root/openspec/changes/rlf-1",
      stateFilePath: "/states/rlf-1/.ralph-state.json",
      branch: null,
      issue: null,
      exitCode: 1,
      useWorktree: false,
      wantPr: false,
      wantAutoMerge: false,
      wantValidateOnly: false,
      respawnWorker: async () => 0,
    });
    expect(input.cfg.stackPrsOnDependencies).toBe(true);
  });
});

describe("computeWantPr", () => {
  test("wants a PR when base intent is set and not awaiting", () => {
    expect(computeWantPr(true, false, false)).toBe(true);
  });

  test("suppresses the PR when reaped into awaitingChangeSet", () => {
    expect(computeWantPr(true, true, false)).toBe(false);
  });

  test("suppresses the PR when coordinator is awaiting confirmation", () => {
    expect(computeWantPr(true, false, true)).toBe(false);
  });

  test("never wants a PR without the base intent", () => {
    expect(computeWantPr(false, false, false)).toBe(false);
    expect(computeWantPr(false, true, true)).toBe(false);
  });
});

describe("computeWantValidateOnly", () => {
  test("true only when a validate spec is present and there is no PR intent", () => {
    expect(computeWantValidateOnly(true, false)).toBe(true);
  });

  test("false when a PR is wanted (PR supersedes validate-only)", () => {
    expect(computeWantValidateOnly(true, true)).toBe(false);
  });

  test("false when there is no validate spec", () => {
    expect(computeWantValidateOnly(false, false)).toBe(false);
    expect(computeWantValidateOnly(false, true)).toBe(false);
  });
});

describe("releaseWorkerMaps", () => {
  test("clears the change key from all four per-change maps", () => {
    const issue = { id: "i1", identifier: "RLF-1" } as LinearIssue;
    const maps: WorkerChangeMaps = {
      cwdByChange: new Map([["c", "/cwd"]]),
      statesDirByChange: new Map([["c", "/states"]]),
      branchByChange: new Map([["c", "branch"]]),
      issueByChange: new Map([["c", issue]]),
    };

    releaseWorkerMaps(maps, "c");

    expect(maps.cwdByChange.has("c")).toBe(false);
    expect(maps.statesDirByChange.has("c")).toBe(false);
    expect(maps.branchByChange.has("c")).toBe(false);
    expect(maps.issueByChange.has("c")).toBe(false);
  });

  test("leaves entries for other changes untouched", () => {
    const maps: WorkerChangeMaps = {
      cwdByChange: new Map([
        ["c", "/cwd"],
        ["other", "/other"],
      ]),
      statesDirByChange: new Map([["other", "/states"]]),
      branchByChange: new Map([["other", "branch"]]),
      issueByChange: new Map(),
    };

    releaseWorkerMaps(maps, "c");

    expect(maps.cwdByChange.has("other")).toBe(true);
    expect(maps.statesDirByChange.has("other")).toBe(true);
  });
});
