import { describe, expect, test, mock } from "bun:test";
import { parseAgentArgs } from "../cli";
import { AgentCoordinator, type CoordinatorDeps } from "../agent/coordinator";
import type { TrackedIssue } from "@ralphy/tracker";
import { createNoopBus } from "@ralphy/events";

function issue(id: string, identifier: string, priority = 3): TrackedIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

interface FakeWorker {
  resolve: (code: number) => void;
}

function makeDeps(todo: TrackedIssue[] = []): {
  deps: CoordinatorDeps;
  workers: Map<string, FakeWorker>;
} {
  const workers = new Map<string, FakeWorker>();
  const deps: CoordinatorDeps = {
    fetchTodo: mock(async () => todo),
    fetchInProgress: mock(async () => []),
    fetchMentions: mock(async () => []),
    fetchDoneCandidates: mock(async () => []),
    fetchReview: mock(async () => []),
    prepare: mock(async (i: TrackedIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    spawnWorker: mock((changeName: string) => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      workers.set(changeName, { resolve });
      return { exited, kill: () => resolve(143) };
    }),
    applyIndicator: async () => {},
    removeIndicator: async () => {},
    postComment: async () => {},
    fetchComments: async () => [],
    checkPrStatus: async () => null,
    isChangeArchivedForIssue: async () => false,
    onLog: () => {},
    onWorkersChanged: () => {},
    bus: createNoopBus(),
  };
  return { deps, workers };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("CLI flags S8 — parseAgentArgs cross-flag validation", () => {
  test("S8.1: --worktree alone is accepted without --create-pr", async () => {
    const result = await parseAgentArgs(["--worktree"]);
    expect(result.worktree).toBe(true);
    expect(result.createPr).toBe(false);
  });

  test("S8.2: --stack-prs without --create-pr is rejected", async () => {
    await expect(parseAgentArgs(["--stack-prs"])).rejects.toThrow(
      "--stack-prs requires --create-pr",
    );
  });

  test("S8.9: --codex + --worktree both parsed correctly", async () => {
    const result = await parseAgentArgs(["--codex", "--worktree"]);
    expect(result.engine).toBe("codex");
    expect(result.worktree).toBe(true);
  });
});

describe("CLI flags S8 — coordinator maxTickets and failure handling", () => {
  test("S8.6: maxTickets=1 with concurrency=2 spawns at most 1 worker", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2")];
    const ctx = makeDeps(issues);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 2, maxTickets: 1 });
    await coord.init();
    const result = await coord.pollOnce();
    await tick();
    expect(result.added).toBe(1);
    expect(coord.activeCount).toBe(1);
    expect(coord.ticketsStartedCount).toBe(1);
  });

  test("S8.10: coordinator does not re-enqueue issue after a worker failure", async () => {
    const issues = [issue("a", "ENG-1")];
    const ctx = makeDeps(issues);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);

    // Worker exits with failure code
    ctx.workers.get("change-eng-1")!.resolve(1);
    await tick();

    // Issue should not be re-queued or active
    expect(coord.activeCount).toBe(0);
    expect(coord.queuedCount).toBe(0);
  });
});
