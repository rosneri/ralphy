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

const CTRL_L = "\x0c";

async function flush(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const fakeWorker: ActiveWorker = {
  changeName: "rlf-72-show-all",
  issueIdentifier: "RLF-72",
  issueId: "issue-72",
  issue: {
    id: "issue-72",
    identifier: "RLF-72",
    title: "Ctrl+L expand",
    url: "https://linear.app/x/issue/RLF-72",
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
      buckets: {
        todo: 0,
        inProgress: 0,
        conflicted: 0,
        ciFailed: 0,
        review: 0,
        mentions: 0,
        awaiting: 0,
      },
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
  checks: false,
};

describe("AgentMode Ctrl+L expanded subtasks", () => {
  let tmpRoot: string;
  let changeDir: string;
  let savedKey: string | undefined;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-show-all-"));
    changeDir = join(tmpRoot, "change");
    await mkdir(changeDir, { recursive: true });
    // 20 subtasks so the panel truncates at MAX_PENDING_DISPLAY=15
    // and surfaces the `(CTRL+L to expand)` footer hint.
    const items: string[] = [];
    for (let i = 1; i <= 20; i += 1) items.push(`- [ ] subtask ${i}`);
    await writeFile(join(changeDir, "tasks.md"), `# Tasks\n\n${items.join("\n")}\n`);
    // Non-stub proposal/design so deriveOpenSpecPhase resolves to `implement`,
    // which is what gates `shouldShowSubtasksPanel` in AgentMode.
    await writeFile(join(changeDir, "proposal.md"), `# Proposal\n\nReal content.\n`);
    await writeFile(join(changeDir, "design.md"), `# Design\n\nReal content.\n`);
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("Ctrl+L toggles the truncated footer hint to the expanded list", async () => {
    const { stdin, lastFrame, unmount } = render(
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
    // Wait for the 1s polling effect to read tasks.md and populate subtasks.
    await flush(1300);
    // Ctrl+T opens the SUBTASKS panel (subtasks are hidden by default).
    stdin.write("\x14");
    await flush(80);
    const initial = lastFrame() ?? "";
    expect(initial).toContain("(CTRL+L to expand)");
    expect(initial).toContain("subtask 1");
    expect(initial).not.toContain("subtask 20");

    stdin.write(CTRL_L);
    await flush(80);
    const expanded = lastFrame() ?? "";
    expect(expanded).not.toContain("(CTRL+L to expand)");
    expect(expanded).toContain("subtask 20");

    stdin.write(CTRL_L);
    await flush(80);
    const collapsed = lastFrame() ?? "";
    expect(collapsed).toContain("(CTRL+L to expand)");
    expect(collapsed).not.toContain("subtask 20");

    unmount();
  });
});
