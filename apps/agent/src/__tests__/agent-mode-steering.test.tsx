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
import type { ParsedArgs } from "../cli";
import type { RalphyConfig } from "../agent/config";

const CTRL_S = "\x13";
const ENTER = "\r";

async function flush(ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
}

const fakeWorker: ActiveWorker = {
  changeName: "rlf-35-agent-mode-steering",
  issueIdentifier: "RLF-35",
  issueId: "issue-123",
  issue: {
    id: "issue-123",
    identifier: "RLF-35",
    title: "Agent mode steering",
    url: "https://linear.app/x/issue/RLF-35",
    priority: 3,
    description: "",
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  },
  mode: "fresh",
  kill: () => {},
  lastReportedIteration: 0,
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
      buckets: { todo: 0, inProgress: 0, conflicted: 0, review: 0, mentions: 0 },
      prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0 },
    }),
    stop: () => {},
    getPause: () => null,
  };
}

function makeBuilder(workers: ActiveWorker[]): AgentModeBuildCoordinator {
  return () => ({
    coord: makeFakeCoord(workers),
    filterDesc: "fake",
    concurrency: 1,
    pollInterval: 999,
    getWorkerCwd: () => undefined,
    runBaselineGate: async () => {},
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
  pollInterval: 999,
  concurrency: 1,
  worktree: false,
  indicators: {},
  createPr: false,
  fixCi: false,
  stackPrs: false,
  codeReview: false,
  maxTickets: 0,
  jsonOutput: false,
  prompt: "",
  manualTest: false,
  debug: false,
};

describe("AgentMode steering", () => {
  let tmpRoot: string;
  let savedKey: string | undefined;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-steering-"));
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders the steering field inside the focused card", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder([fakeWorker]),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
      }),
    );
    await flush(150);
    expect(lastFrame() ?? "").toContain("CTRL+S to steer");
    unmount();
  });

  test("Ctrl+S + hello + Enter calls appendSteering with the worker's changeName", async () => {
    const calls: Array<{ dir: string; msg: string }> = [];
    const { stdin, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async (dir: string, msg: string) => {
          calls.push({ dir, msg });
        },
        buildCoordinator: makeBuilder([fakeWorker]),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
      }),
    );
    await flush(150);
    stdin.write(CTRL_S);
    await flush(50);
    stdin.write("hello");
    await flush(50);
    stdin.write(ENTER);
    await flush(80);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.msg).toBe("hello");
    expect(calls[0]!.dir).toBe(join(tmpRoot, "tasks", "rlf-35-agent-mode-steering"));
    unmount();
  });

  test("steering field is absent when there are no active workers", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilder([]),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
      }),
    );
    await flush(150);
    expect(lastFrame() ?? "").not.toContain("CTRL+S to steer");
    unmount();
  });
});
