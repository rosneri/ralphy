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
import type { TrackedIssue } from "@ralphy/tracker";

const baseArgs = (): Promise<AgentParsedArgs> => parseAgentArgs([]);
const baseCfg = (o: Record<string, unknown> = {}): RalphyConfig => WorkflowConfigSchema.parse(o);

const WORKFLOW_PATH = "/root/WORKFLOW.md";

// Pure decisions extracted from the spawn-worker exit handler, asserted
// without constructing the closure (the release-maps.ts pattern).

describe("buildTaskCmd", () => {
  test("emits the loop task argv terminated by --from-agent", async () => {
    const cmd = buildTaskCmd(await baseArgs(), "rlf-1", WORKFLOW_PATH);
    expect(cmd.slice(2, 6)).toEqual(["loop", "task", "--name", "rlf-1"]);
    expect(cmd[cmd.length - 1]).toBe("--from-agent");
  });

  test("with no CLI overrides the argv carries no config values — the child re-resolves", async () => {
    const cmd = buildTaskCmd(await baseArgs(), "rlf-1", WORKFLOW_PATH);
    // No pre-merged engine/model/limits in the spawn command: the worker
    // resolves WORKFLOW.md itself, so parent and child share one merge path.
    expect(cmd).toEqual([
      process.execPath,
      process.argv[1] ?? "",
      "loop",
      "task",
      "--name",
      "rlf-1",
      "--workflow",
      WORKFLOW_PATH,
      "--from-agent",
    ]);
  });

  test("forwards exactly the user's sparse overrides", async () => {
    const args = await parseAgentArgs([
      "--codex",
      "--model",
      "sonnet",
      "--max-iterations",
      "7",
      "--max-cost",
      "3.5",
      "--max-runtime",
      "42",
      "--delay",
      "9",
    ]);
    const cmd = buildTaskCmd(args, "rlf-1", WORKFLOW_PATH);
    expect(cmd).toContain("--codex");
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("sonnet");
    expect(cmd[cmd.indexOf("--max-iterations") + 1]).toBe("7");
    expect(cmd[cmd.indexOf("--max-cost") + 1]).toBe("3.5");
    expect(cmd[cmd.indexOf("--max-runtime") + 1]).toBe("42");
    expect(cmd[cmd.indexOf("--delay") + 1]).toBe("9");
  });

  test("an explicit --max-failures is forwarded even at the old sentinel value 5", async () => {
    // The old `!== 5` check dropped a user's explicit 5; presence-based
    // overrides forward it like any other value.
    const args = await parseAgentArgs(["--max-failures", "5"]);
    const cmd = buildTaskCmd(args, "rlf-1", WORKFLOW_PATH);
    expect(cmd[cmd.indexOf("--max-failures") + 1]).toBe("5");

    const none = buildTaskCmd(await baseArgs(), "rlf-1", WORKFLOW_PATH);
    expect(none).not.toContain("--max-failures");
  });

  test("boolean passthrough flags are forwarded only when the user set them", async () => {
    const args = await parseAgentArgs(["--log", "--verbose", "--manual-test"]);
    const cmd = buildTaskCmd(args, "rlf-1", WORKFLOW_PATH);
    expect(cmd).toContain("--log");
    expect(cmd).toContain("--verbose");
    expect(cmd).toContain("--manual-test");

    const none = buildTaskCmd(await baseArgs(), "rlf-1", WORKFLOW_PATH);
    expect(none).not.toContain("--log");
    expect(none).not.toContain("--verbose");
    expect(none).not.toContain("--manual-test");
  });

  test("pins the worker to the parent's WORKFLOW.md via --workflow", async () => {
    const cmd = buildTaskCmd(await baseArgs(), "rlf-1", "/elsewhere/ALT.md");
    expect(cmd[cmd.indexOf("--workflow") + 1]).toBe("/elsewhere/ALT.md");
  });

  test("recovery triggers carry --trigger; other triggers pass nothing", async () => {
    const args = await baseArgs();
    for (const trigger of ["ci-fix", "conflict-fix"] as const) {
      const cmd = buildTaskCmd(args, "rlf-1", WORKFLOW_PATH, trigger);
      expect(cmd[cmd.indexOf("--trigger") + 1]).toBe(trigger);
      expect(cmd[cmd.length - 1]).toBe("--from-agent");
    }
    for (const trigger of ["fresh", "resume", "review", undefined] as const) {
      expect(buildTaskCmd(args, "rlf-1", WORKFLOW_PATH, trigger)).not.toContain("--trigger");
    }
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
    // typecheck is "" so it is filtered out of validateCommands; structure
    // carries its schema default and rides alongside test + lint.
    expect(input.cfg.validateCommands).toEqual(["bun test", "bun lint", "bun run check:structure"]);
    expect(input.changeName).toBe("rlf-1");
    expect(input.branch).toBe("feat/rlf-1");
    expect(input.wantPr).toBe(true);
  });

  test("includes the structure command in validateCommands by default", async () => {
    // commands.structure defaults to `bun run check:structure`, so the in-loop
    // structural gate runs each iteration without any WORKFLOW.md opt-in.
    const cfg = baseCfg({ commands: { test: "bun test" } });
    const input = await build({ cfg });
    expect(input.cfg.validateCommands).toContain("bun run check:structure");
  });

  test("an empty structure command opts the project out of the structural gate", async () => {
    const cfg = baseCfg({ commands: { test: "bun test", structure: "" } });
    const input = await build({ cfg });
    expect(input.cfg.validateCommands).toEqual(["bun test"]);
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
    const issue = { id: "i1", identifier: "RLF-1" } as TrackedIssue;
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
