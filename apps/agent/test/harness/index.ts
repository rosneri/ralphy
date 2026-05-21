import type { CoordinatorDeps, PrepareResult } from "../../src/runtime/coordinator";
import type { LinearIssue } from "../../src/shared/capabilities/linear-client";
import { createNoopBus } from "@ralphy/events";
import { createFakeLinear, type FakeLinear, type FakeLinearIndicators } from "./fake-linear";
import { createFakeGh, type FakeGh } from "./fake-gh";
import { createTmpFs, type TmpFs } from "./tmp-fs";
import { createTmpRepo, type TmpRepo } from "./tmp-repo";
import { createScriptedEngine, type EngineLike } from "./scripted-engine";
import { createVirtualClock, type VirtualClock } from "./clock";
import { getScenario } from "./scenarios";
import type { HarnessCtx } from "./types";

export type { HarnessCtx, ScenarioStep, SeedIssue, LinearClientLike } from "./types";
export { createFakeLinear } from "./fake-linear";
export { createFakeGh } from "./fake-gh";
export { createTmpFs } from "./tmp-fs";
export { createTmpRepo } from "./tmp-repo";
export { createScriptedEngine } from "./scripted-engine";
export { createVirtualClock } from "./clock";
export { registry as scenarioRegistry, getScenario } from "./scenarios";

export interface CreateHarnessOptions {
  scenario: string;
  /** Indicator config used by the FakeLinear filters. Defaults to a
   *  todo-label / in-progress-status / conflicted-label / review-label set. */
  indicators?: FakeLinearIndicators;
  startTime?: Date;
}

export interface ExtendedHarnessCtx extends HarnessCtx {
  gh: FakeGh;
  fs: TmpFs;
  repo: TmpRepo;
  engine: EngineLike;
  clock: VirtualClock;
}

const DEFAULT_INDICATORS: FakeLinearIndicators = {
  getTodo: { filter: [{ type: "label", value: "ralphy:todo" }] },
  getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
  getConflicted: { filter: [{ type: "label", value: "ralphy:conflicted" }] },
  getReview: { filter: [{ type: "label", value: "ralphy:review" }] },
};

interface PendingWorker {
  changeName: string;
  issue: LinearIssue;
  resolveExit: (code: number) => void;
  exited: Promise<number>;
}

export async function createHarness(opts: CreateHarnessOptions): Promise<ExtendedHarnessCtx> {
  const scenario = getScenario(opts.scenario);
  const fs = await createTmpFs();
  const repo = await createTmpRepo();
  const linear = createFakeLinear(opts.indicators ?? DEFAULT_INDICATORS);
  const gh = createFakeGh();
  const engine = createScriptedEngine({ scenario: scenario.transcript });
  const clock = createVirtualClock(opts.startTime ?? new Date("2025-01-01T00:00:00Z"));

  for (const seed of scenario.seedIssues) linear.seed(seed);

  // Seed a scripted PR per issue so the fake spawnWorker can record a URL.
  for (const seed of scenario.seedIssues) {
    gh.script({
      branch: `ralphy/${seed.identifier.toLowerCase()}`,
      prUrl: `https://github.com/test/repo/pull/${seed.identifier}`,
    });
  }

  const pending: PendingWorker[] = [];

  const coordDeps: CoordinatorDeps = {
    fetchTodo: () => linear.client.fetchTodo(),
    fetchInProgress: () => linear.client.fetchInProgress(),
    fetchConflicted: () => linear.client.fetchConflicted(),
    fetchReview: () => linear.client.fetchReview(),
    fetchMentions: () => linear.client.fetchMentions(),
    fetchDoneCandidates: () => linear.client.fetchDoneCandidates(),
    fetchComments: (issueId) => linear.client.fetchComments(issueId),
    prepare: async (issue) => {
      const changeName = `change-${issue.identifier.toLowerCase()}`;
      await fs.seedTasks(changeName, ["- [ ] do thing"]);
      const result: PrepareResult = {
        changeName,
        prUrl: `https://github.com/test/repo/pull/${issue.identifier}`,
      };
      return result;
    },
    spawnWorker: (changeName, issue) => {
      let resolveExit: (code: number) => void = () => {};
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      pending.push({ changeName, issue, resolveExit, exited });
      return { exited, kill: () => resolveExit(143) };
    },
    applyIndicator: (issue, ind) => linear.client.applyIndicator(issue, ind),
    removeIndicator: (issue, ind) => linear.client.removeIndicator(issue, ind),
    postComment: (issue, body) => linear.client.postComment(issue, body),
    checkPrStatus: async () => null,
    onLog: () => {},
    onWorkersChanged: () => {},
    bus: createNoopBus(),
  };

  async function runWorkerToCompletion(): Promise<void> {
    // Drain the scripted engine for each pending worker, then resolve exit=0.
    while (pending.length > 0) {
      const w = pending.shift();
      if (!w) break;
      // Play any remaining transcript steps; ignore exhaustion since the
      // harness smoke test only exercises one scenario per harness.
      while (engine.remaining() > 0) {
        const step = await engine.next();
        if (step.kind === "exit") {
          const payload = step.payload as { code?: number } | undefined;
          w.resolveExit(payload?.code ?? 0);
          break;
        }
      }
      // Ensure the worker is resolved even if the transcript was empty.
      w.resolveExit(0);
      await w.exited;
    }
  }

  async function cleanup(): Promise<void> {
    await fs.cleanup();
    await repo.cleanup();
  }

  return {
    coordDeps,
    linear: {
      client: linear.client,
      applied: linear.applied,
      seed: linear.seed,
      setLabels: linear.setLabels,
      setStatus: linear.setStatus,
      pushComment: linear.pushComment,
      pushMention: linear.pushMention,
      comments: linear.comments,
      issues: linear.issues,
    },
    runWorkerToCompletion,
    cleanup,
    gh,
    fs,
    repo,
    engine,
    clock,
  } satisfies ExtendedHarnessCtx;
}

export type { FakeLinear, FakeGh, TmpFs, TmpRepo, EngineLike, VirtualClock };
