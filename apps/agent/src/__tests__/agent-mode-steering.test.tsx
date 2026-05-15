import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { AgentMode } from "../components/AgentMode";

const CTRL_S = "\x13";
const ENTER = "\r";

async function flush(ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
}

const fakeWorker = {
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
  },
  mode: "fresh" as const,
  kill: () => {},
  lastReportedIteration: 0,
};

function makeFakeCoord(workers: (typeof fakeWorker)[]) {
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

function makeBuilder(
  workers: (typeof fakeWorker)[],
): NonNullable<Parameters<typeof AgentMode>[0]["buildCoordinator"]> {
  return (() => ({
    coord: makeFakeCoord(workers),
    filterDesc: "fake",
    concurrency: 1,
    pollInterval: 999,
    getWorkerCwd: () => undefined,
    runBaselineGate: async () => {},
  })) as unknown as NonNullable<Parameters<typeof AgentMode>[0]["buildCoordinator"]>;
}

const fakeConfig = {
  engine: "claude",
  model: "sonnet",
  concurrency: 1,
  pollIntervalSeconds: 999,
  maxIterationsPerTask: 0,
  maxCostUsdPerTask: 0,
  createPrOnSuccess: false,
  fixCiOnFailure: false,
  useWorktree: false,
  linear: { team: "RLF", assignee: "me", indicators: {} },
} as unknown as Awaited<ReturnType<NonNullable<Parameters<typeof AgentMode>[0]["loadConfig"]>>>;

const ensureConfigStub = async () => "/tmp/ralphy.json";
const loadConfigStub = async () => fakeConfig;

const baseArgs = {
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
} as unknown as Parameters<typeof AgentMode>[0]["args"];

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
