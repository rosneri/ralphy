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
import type { AgentParsedArgs as ParsedArgs } from "../cli";
import type { RalphyConfig } from "../agent/config";

async function flush(ms = 150) {
  await new Promise((r) => setTimeout(r, ms));
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
};

function makeBuilderWithAwaiting(
  awaitingCount: number,
  fireAwaiting?: {
    changeName: string;
    issueIdentifier: string;
    issueUrl: string;
    issueTitle: string;
    since: string | null;
    round: number;
  },
): AgentModeBuildCoordinator {
  return (input) => {
    const onAwaitingTicket = input.onAwaitingTicket;
    const coord: AgentModeCoordinator = {
      activeWorkers: [],
      activeCount: 0,
      queuedCount: 0,
      init: async () => {},
      pollOnce: async () => {
        if (fireAwaiting && onAwaitingTicket) onAwaitingTicket(fireAwaiting);
        return {
          found: awaitingCount,
          added: 0,
          buckets: {
            todo: 0,
            inProgress: 0,
            conflicted: 0,
            ciFailed: 0,
            review: 0,
            mentions: 0,
            awaiting: awaitingCount,
          },
          prStatus: { mergeable: 0, conflicted: 0, ciFailed: 0 },
          phase: {},
          flow: {},
        };
      },
      stop: () => {},
      getPause: () => null,
      restartWorker: async () => true,
    };
    return {
      coord,
      filterDesc: "fake",
      concurrency: 1,
      pollInterval: 60,
      getWorkerCwd: () => undefined,
      runBaselineGate: async () => {},
    };
  };
}

describe("AgentMode awaiting-confirmation", () => {
  let tmpRoot: string;
  let savedKey: string | undefined;
  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-mode-awaiting-"));
    savedKey = process.env["LINEAR_API_KEY"];
    process.env["LINEAR_API_KEY"] = "fake";
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("renders `awaiting N` in the POLL STATUS row when buckets.awaiting > 0", async () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilderWithAwaiting(2),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    // Ink wraps long lines inside the POLL STATUS box on narrow widths and
    // splits words across rows. The bucket label fragments ("await" + "ing")
    // and the count appear in the same row, so we just look for both parts.
    expect(frame).toContain("await");
    expect(frame).toMatch(/await[a-z]*\s+2/);
    unmount();
  });

  test("renders a [GATE] card for each ticket reported via onAwaitingTicket", async () => {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { lastFrame, unmount } = render(
      React.createElement(AgentMode, {
        args: baseArgs,
        projectRoot: tmpRoot,
        statesDir: join(tmpRoot, "states"),
        tasksDir: join(tmpRoot, "tasks"),
        appendSteering: async () => {},
        buildCoordinator: makeBuilderWithAwaiting(1, {
          changeName: "rlf-78-foo",
          issueIdentifier: "RLF-78",
          issueUrl: "https://linear.app/x/issue/RLF-78",
          issueTitle: "Confirmation gate test",
          since,
          round: 1,
        }),
        ensureConfig: ensureConfigStub,
        loadConfig: loadConfigStub,
        runPreflight: async () => ({ ok: true as const }),
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    // Ink wraps "[GATE]" across rows on narrow widths. Look for the visible
    // pieces (RLF-78 label + GATE prefix + round/asked indicators).
    expect(frame).toContain("RLF-78");
    expect(frame).toContain("[GATE");
    expect(frame).toContain("Awaiting");
    expect(frame).toMatch(/round\s+1/);
    expect(frame).toMatch(/asked\s+5m\d{2}s\s+ago/);
    unmount();
  });
});
