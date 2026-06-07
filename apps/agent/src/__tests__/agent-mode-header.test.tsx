import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { initialCommonArgs } from "@ralphy/cli-args";
import { WorkflowConfigSchema } from "@ralphy/workflow/schema";
import {
  AgentMode,
  type AgentModeBuildCoordinator,
  type AgentModeCoordinator,
} from "../components/AgentMode";
import type { ActiveWorker } from "../agent/coordinator";
import type { AgentParsedArgs as ParsedArgs } from "../cli";
import type { RalphyConfig } from "../agent/config";

async function flush(ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
}

function makeFakeCoord(workers: ActiveWorker[]): AgentModeCoordinator {
  return {
    activeWorkers: workers,
    activeCount: workers.length,
    queuedCount: 0,
    init: async () => {},
    pollOnce: async () => ({
      found: 0,
      added: 0,
      buckets: {
        todo: 0,
        inProgress: 0,
        conflicted: 0,
        ciFailed: 0,
        review: 0,
        mentions: 0,
        quarantined: 0,
        awaiting: 0,
      },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0, quarantined: 0 },
      phase: {},
      flow: {},
    }),
    stop: () => {},
    getPause: () => null,
    restartWorker: async () => true,
  };
}

function makeBuilder(concurrency: number, pollInterval: number): AgentModeBuildCoordinator {
  return () => ({
    coord: makeFakeCoord([]),
    filterDesc: "fake",
    concurrency,
    pollInterval,
    getWorkerCwd: () => undefined,
    runBaselineGate: async () => {},
    getGaveUpTotal: async () => 0,
  });
}

const fakeConfig: RalphyConfig = {
  ...WorkflowConfigSchema.parse({}),
  engine: "claude",
  model: "sonnet",
};

const ensureConfigStub = async () => "/tmp/ralphy.json";
const loadConfigStub = async (): Promise<RalphyConfig> => fakeConfig;

const baseArgs: ParsedArgs = {
  ...initialCommonArgs(),
  mode: "agent",
  name: "",
  linearTeam: "RLF",
  linearAssignee: "me",
  ticketTokens: [],
  pollInterval: 0,
  concurrency: 0,
  worktree: false,
  indicators: {},
  createPr: false,
  fixCi: false,
  noTmux: false,
  stackPrs: false,
  codeReview: false,
  maxTickets: 0,
  jsonOutput: false,
  prompt: "",
  manualTest: false,
  debug: false,
  agentDebug: false,
  checks: false,
  review: false,
};

describe("AgentMode header", () => {
  let tmpRoot: string;
  let savedKey: string | undefined;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-header-"));
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders effective concurrency and pollInterval from CLI overrides", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: { ...baseArgs, concurrency: 4, pollInterval: 1000 },
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder(4, 1000),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush(150);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("×4");
    expect(frame).toContain("poll 1000s");
    unmount();
  });

  test("falls back to config-file values when CLI args are 0", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder(fakeConfig.concurrency, fakeConfig.pollIntervalSeconds),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush(150);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`×${fakeConfig.concurrency}`);
    expect(frame).toContain(`poll ${fakeConfig.pollIntervalSeconds}s`);
    unmount();
  });
});
