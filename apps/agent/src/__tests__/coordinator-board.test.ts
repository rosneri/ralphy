import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCoordinator, type CoordinatorDeps, type MentionTrigger } from "../agent/coordinator";
import type { PrStatusBucket } from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import { createNoopBus } from "@ralphy/events";
import { PrTracker } from "../features/pr-tracker/tracker";
import { FlowActorStore, flowMachine, preemptionActorLogic } from "@ralphy/core/machines";
import { statusLabel, type TicketRow } from "../components/task-pipeline";

const NOW = () => new Date("2026-06-01T12:00:00.000Z");

function issue(id: string, identifier: string, blockedByIds: string[] = []): LinearIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds,
  };
}

interface BoardDeps {
  root: string;
  deps: CoordinatorDeps;
  changeDirByIssue: Map<string, string>;
  prByIssue: Map<string, { url: string; status: PrStatusBucket } | null>;
  setTodo: (xs: LinearIssue[]) => void;
  setInProgress: (xs: LinearIssue[]) => void;
  setMentions: (xs: { issue: LinearIssue; trigger: MentionTrigger }[]) => void;
  setDoneCandidates: (xs: LinearIssue[]) => void;
}

function makeBoardDeps(): BoardDeps {
  const root = mkdtempSync(join(tmpdir(), "ralphy-board-"));
  const changeDirByIssue = new Map<string, string>();
  const prByIssue = new Map<string, { url: string; status: PrStatusBucket } | null>();
  let todo: LinearIssue[] = [];
  let inProgress: LinearIssue[] = [];
  let mentions: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
  let doneCandidates: LinearIssue[] = [];

  const deps: CoordinatorDeps = {
    fetchTodo: async () => todo,
    fetchInProgress: async () => inProgress,
    fetchMentions: async () => mentions,
    fetchDoneCandidates: async () => doneCandidates,
    fetchReview: async () => [],
    prepare: async (i) => ({ changeName: `change-${i.identifier.toLowerCase()}` }),
    spawnWorker: () => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      return { exited, kill: () => resolve(143) };
    },
    applyIndicator: async () => {},
    removeIndicator: async () => {},
    postComment: async () => {},
    fetchComments: async () => [],
    checkPrStatus: async (i) => prByIssue.get(i.id) ?? null,
    getChangeDir: (i) => changeDirByIssue.get(i.id) ?? null,
    onLog: () => {},
    onWorkersChanged: () => {},
  };

  return {
    root,
    deps,
    changeDirByIssue,
    prByIssue,
    setTodo: (xs) => {
      todo = xs;
    },
    setInProgress: (xs) => {
      inProgress = xs;
    },
    setMentions: (xs) => {
      mentions = xs;
    },
    setDoneCandidates: (xs) => {
      doneCandidates = xs;
    },
  };
}

/** Seed a persisted flow snapshot in `changeDir` by driving a real actor
 *  through `events` and flushing it. The coordinator's own `FlowActorStore`
 *  rehydrates the same snapshot via `getChangeDir`. */
async function seedFlow(
  root: string,
  ctx: BoardDeps,
  issueId: string,
  events: { type: string }[],
): Promise<void> {
  const changeDir = join(root, "changes", issueId);
  mkdirSync(changeDir, { recursive: true });
  ctx.changeDirByIssue.set(issueId, changeDir);
  const machine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });
  const store = new FlowActorStore({ bus: createNoopBus(), persist: () => {} }, machine);
  const actor = await store.getActor(issueId, changeDir);
  for (const e of events) actor.send(e as Parameters<typeof actor.send>[0]);
  await store.persistActor(issueId, changeDir);
}

const TO_AWAITING_CI = [{ type: "FRESH_PICKED_UP" }, { type: "PR_OPENED" }];
const TO_DONE = [{ type: "FRESH_PICKED_UP" }, { type: "WORKER_SUCCEEDED" }];

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function rowFor(board: TicketRow[], identifier: string): TicketRow | undefined {
  return board.find((r) => r.identifier === identifier);
}

describe("AgentCoordinator — lifecycle board", () => {
  test("parked awaiting-ci + uncleared non-bailed entry renders as ci-fix even with fixCi off", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const ban467 = issue("u2", "BAN-467");
    ctx.setInProgress([ban467]);
    ctx.setDoneCandidates([ban467]);
    ctx.prByIssue.set("u2", { url: "https://github.com/x/y/pull/18225", status: "ci_failed" });
    await seedFlow(ctx.root, ctx, "u2", TO_AWAITING_CI);

    // Two CI failures recorded earlier, below the bail threshold.
    const tracker = new PrTracker({ projectRoot: ctx.root, maxRecoveryAttempts: 5, now: NOW });
    await tracker.recordFailure("BAN-467", "ci_failed");
    await tracker.recordFailure("BAN-467", "ci_failed");

    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      prTracker: tracker,
      prRecovery: { enabled: true, fixCi: false, fixConflicts: true },
    });
    const result = await coord.pollOnce();

    const row = rowFor(result.board, "BAN-467");
    expect(row).toBeDefined();
    expect(row!.state).toBe("ci-fix");
    expect(row!.recovery).toMatchObject({ attempts: 2, lastReason: "ci_failed", bailed: false });
    expect(row!.prUrl).toBe("https://github.com/x/y/pull/18225");
    expect(statusLabel(row!)).toBe("CI red · 2 fix attempts");
    // The ticket stayed parked — fixCi off means no recovery worker queued.
    expect(coord.activeCount).toBe(0);
    expect(coord.queuedCount).toBe(0);
  });

  test("bailed pr-tracker entry overlays as quarantined regardless of actor state", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const ban799 = issue("u1", "BAN-799");
    ctx.setInProgress([ban799]);
    await seedFlow(ctx.root, ctx, "u1", TO_AWAITING_CI);

    const tracker = new PrTracker({ projectRoot: ctx.root, maxRecoveryAttempts: 3, now: NOW });
    await tracker.recordFailure("BAN-799", "conflicting");
    await tracker.recordFailure("BAN-799", "conflicting");
    await tracker.recordFailure("BAN-799", "ci_failed"); // tips into bail at attempts=3

    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 0,
      prTracker: tracker,
      // No doneCandidates → the scan never touches this ticket, so the bail is preserved.
      prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
    });
    const result = await coord.pollOnce();

    const row = rowFor(result.board, "BAN-799");
    expect(row).toBeDefined();
    expect(row!.state).toBe("quarantined");
    expect(row!.recovery).toMatchObject({ attempts: 3, bailed: true });
    expect(statusLabel(row!)).toContain("quarantined");
  });

  test("done / disposed actors are excluded from the board", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const finished = issue("u3", "BAN-900");
    ctx.setInProgress([finished]);
    await seedFlow(ctx.root, ctx, "u3", TO_DONE);

    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    const result = await coord.pollOnce();

    expect(rowFor(result.board, "BAN-900")).toBeUndefined();
  });

  test("an unenqueued (blocked) todo renders as a todo row", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const blocked = issue("u4", "BAN-100", ["nonexistent-blocker"]);
    ctx.setTodo([blocked]);

    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    const result = await coord.pollOnce();

    const row = rowFor(result.board, "BAN-100");
    expect(row).toBeDefined();
    expect(row!.state).toBe("todo");
    expect(row!.recovery).toBeUndefined();
    expect(row!.url).toBe("https://example/BAN-100");
  });

  test("a ticket present in multiple sources is deduplicated to a single row", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const dup = issue("u5", "BAN-200");
    ctx.setTodo([dup]);
    ctx.setInProgress([dup]);
    await seedFlow(ctx.root, ctx, "u5", TO_AWAITING_CI);

    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    const result = await coord.pollOnce();

    const matches = result.board.filter((r) => r.identifier === "BAN-200");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.state).toBe("awaiting-ci");
  });

  test("no live tickets → empty board", async () => {
    const ctx = makeBoardDeps();
    roots.push(ctx.root);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    const result = await coord.pollOnce();
    expect(result.board).toEqual([]);
  });
});
