import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function flush(ms = 1300) {
  await new Promise((r) => setTimeout(r, ms));
}

const fakeWorker: ActiveWorker = {
  changeName: "rlf-91-chip",
  issueIdentifier: "RLF-91",
  issueId: "issue-91",
  issue: {
    id: "issue-91",
    identifier: "RLF-91",
    title: "Chip vs pipeline",
    url: "https://linear.app/x/issue/RLF-91",
    priority: 3,
    description: "",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    createdAt: "2026-05-15T00:00:00.000Z",
    blockedByIds: [],
  },
  trigger: "fresh",
  kill: () => {},
  lastReportedIteration: 0,
  lastSyncedIteration: 0,
  restarting: false,
  reapedForAwaiting: false,
};

function makeFakeCoord(workers: ActiveWorker[]): AgentModeCoordinator {
  return {
    activeWorkers: workers,
    activeCount: workers.length,
    queuedCount: 0,
    init: async () => {},
    pollOnce: async () => ({
      found: 0,
      added: 0,
      buckets: { todo: 0, inProgress: 0, conflicted: 0, review: 0, mentions: 0, awaiting: 0 },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0 },
      phase: {},
      flow: {},
    }),
    stop: () => {},
    getPause: () => null,
    restartWorker: async () => true,
  };
}

function makeBuilder(workers: ActiveWorker[], changeDir: string): AgentModeBuildCoordinator {
  return (input) => {
    queueMicrotask(() => {
      for (const w of workers) {
        input.onWorkerStarted(w.changeName, "/tmp/states", "/tmp/log.txt", changeDir);
      }
    });
    return {
      coord: makeFakeCoord(workers),
      filterDesc: "fake",
      concurrency: 1,
      pollInterval: 999,
      getWorkerCwd: () => undefined,
      runBaselineGate: async () => {},
    };
  };
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
  pollInterval: 999,
  concurrency: 1,
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
};

describe("AgentMode phase pipeline", () => {
  let tmpRoot: string;
  let changeDir: string;
  let savedKey: string | undefined;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-chip-"));
    changeDir = join(tmpRoot, "change");
    await mkdir(changeDir, { recursive: true });
    // Real proposal + real design + no tasks.md → phase resolves to `tasks`,
    // which falls inside `shouldShowPhasePipeline` so the pipeline renders.
    await writeFile(join(changeDir, "proposal.md"), "# Proposal\n\nReal proposal content.\n");
    await writeFile(join(changeDir, "design.md"), "# Design\n\nReal design content.\n");
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders the phase pipeline", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder([fakeWorker], changeDir),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    // Pipeline segments still render (proposal / design / tasks).
    expect(frame).toMatch(/proposal/);
    expect(frame).toMatch(/design/);
    expect(frame).toMatch(/tasks/);
    unmount();
  });
});
