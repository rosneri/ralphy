import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IterationUsage, State } from "@ralphy/types";
import type { Agent, AgentRequest, AgentRunResult } from "@ralphy/engine/engine";
import type { ChangeStatus } from "@ralphy/change-store";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { projectLayout } from "../layout";
import { buildInitialState, writeState, readState } from "../state";
import { createLoopRunner, type LoopRunnerEvent, type LoopRunnerOptions } from "../loop-runner";
import type { LoopChangeStore } from "../loop";

const NAME = "my-change";

let root: string;
let stateDir: string;
let tasksDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loop-runner-test-"));
  const layout = projectLayout(root);
  stateDir = layout.taskStateDir(NAME);
  tasksDir = layout.changeDir(NAME);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function usage(cost: number): IterationUsage {
  return {
    cost_usd: cost,
    duration_ms: 10,
    num_turns: 1,
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function ok(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    exitCode: 0,
    usage: usage(0.1),
    sessionId: "session-1",
    rateLimited: false,
    ...overrides,
  };
}

type AgentStep = (req: AgentRequest) => AgentRunResult | Promise<AgentRunResult>;

interface FakeAgent extends Agent {
  calls: AgentRequest[];
}

/** Scripted engine port: each run() consumes the next step (the last step
 *  repeats). Steps can mutate the change dir to simulate agent work. */
function fakeAgent(...steps: AgentStep[]): FakeAgent {
  const calls: AgentRequest[] = [];
  return {
    calls,
    name: "claude",
    async run(req: AgentRequest): Promise<AgentRunResult> {
      calls.push(req);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (!step) throw new Error("fakeAgent: no steps configured");
      return step(req);
    },
  };
}

interface FakeChangeStore extends LoopChangeStore {
  archived: string[];
}

function fakeChangeStore(overrides: Partial<LoopChangeStore> = {}): FakeChangeStore {
  const archived: string[] = [];
  const status: ChangeStatus = {
    changeName: NAME,
    isComplete: true,
    applyRequires: [],
    artifacts: [],
  };
  return {
    archived,
    archiveChange: async (name: string) => {
      archived.push(name);
    },
    listChanges: async () => [NAME],
    getStatus: async () => status,
    ...overrides,
  };
}

interface GitCalls {
  pushes: number;
  commits: { dir: string; message: string }[];
}

function fakeGit(uncommitted: () => readonly string[] = () => []) {
  const calls: GitCalls = { pushes: 0, commits: [] };
  return {
    calls,
    git: {
      push: () => {
        calls.pushes++;
      },
      commitTaskDir: (dir: string, message: string) => {
        calls.commits.push({ dir, message });
      },
      getUncommittedFiles: uncommitted,
    },
  };
}

function makeRunner(agent: Agent, overrides: Partial<LoopRunnerOptions> = {}) {
  const { git } = fakeGit();
  const events: LoopRunnerEvent[] = [];
  const runner = createLoopRunner({
    name: NAME,
    engine: "claude",
    model: "opus",
    ...overrides,
    deps: {
      agent,
      layout: projectLayout(root),
      changeStore: fakeChangeStore(),
      git,
      sleep: async () => {},
      ...overrides.deps,
    },
  });
  runner.subscribe((event) => events.push(event));
  return { runner, events };
}

const UNCHECKED_TASKS = "## Work\n\n- [ ] do the thing\n";
const CHECKED_TASKS = "## Work\n\n- [x] do the thing\n";

function writeTasks(content: string) {
  writeFileSync(join(tasksDir, "tasks.md"), content, "utf-8");
}

function readStateInCtx(): State {
  return runWithContext(createDefaultContext({ layout: projectLayout(root) }), () =>
    readState(stateDir),
  );
}

function stoppedEvent(events: LoopRunnerEvent[]) {
  return events.find((e) => e.type === "stopped") as Extract<LoopRunnerEvent, { type: "stopped" }>;
}

describe("LoopRunner — stop conditions (machine-arbitrated)", () => {
  test("stops at maxIterations when tasks never complete", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const { runner, events } = makeRunner(agent, { limits: { maxIterations: 3 } });

    const reason = await runner.start();

    expect(reason).toBe("maxIterations");
    expect(agent.calls.length).toBe(3);
    expect(stoppedEvent(events).iterations).toBe(3);
    expect(runner.getSnapshot().isRunning).toBe(false);
    expect(runner.getSnapshot().stopReason).toBe("maxIterations");
    expect(events.filter((e) => e.type === "iteration-started").length).toBe(3);
    expect(
      events.filter((e) => e.type === "iteration-finished" && e.result === "success").length,
    ).toBe(3);
    // stopped must be the final event
    expect(events[events.length - 1]?.type).toBe("stopped");
  });

  test("stops at costCap when accumulated engine cost crosses the limit", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok({ usage: usage(0.6) }));
    const { runner } = makeRunner(agent, { limits: { maxCostUsd: 1 } });

    const reason = await runner.start();

    expect(reason).toBe("costCap");
    expect(agent.calls.length).toBe(2);
  });

  test("stops at runtimeLimit via the injected clock before running any iteration", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const { runner } = makeRunner(agent, {
      limits: { maxRuntimeMinutes: 60 },
      // Loop start time 61 minutes in the past: the machine's runtime guard
      // trips on the first checkingStop pass.
      deps: { now: () => Date.now() - 61 * 60_000 },
    });

    const reason = await runner.start();

    expect(reason).toBe("runtimeLimit");
    expect(agent.calls.length).toBe(0);
  });

  test("stops after N consecutive failures — machine counts ANY failures, not only identical ones", async () => {
    writeTasks(UNCHECKED_TASKS);
    // Different exit codes each time: the machine still counts them as
    // consecutive failures (reconciled semantics — the sidecar used to
    // require identical failures).
    const agent = fakeAgent(
      () => ok({ exitCode: 1 }),
      () => ok({ exitCode: 2 }),
    );
    const { runner, events } = makeRunner(agent, { limits: { maxConsecutiveFailures: 2 } });

    const reason = await runner.start();

    expect(reason).toBe("consecutiveFailures");
    expect(agent.calls.length).toBe(2);
    const finished = events.filter((e) => e.type === "iteration-finished");
    expect(finished.map((e) => e.result)).toEqual(["failed:exit-1", "failed:exit-2"]);
    // Failed iterations do not increment the machine's iteration counter.
    expect(stoppedEvent(events).iterations).toBe(0);
  });

  test("a success resets the consecutive-failure counter", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(
      () => ok({ exitCode: 1 }),
      () => ok(),
      () => ok({ exitCode: 1 }),
      () => ok({ exitCode: 1 }),
    );
    const { runner } = makeRunner(agent, {
      limits: { maxConsecutiveFailures: 2, maxIterations: 10 },
    });

    const reason = await runner.start();

    expect(reason).toBe("consecutiveFailures");
    expect(agent.calls.length).toBe(4);
  });

  test("stops with rateLimited on a clean exit that reports a usage limit", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok({ rateLimited: true }));
    const { runner, events } = makeRunner(agent);

    const reason = await runner.start();

    expect(reason).toBe("rateLimited");
    expect(agent.calls.length).toBe(1);
    const finished = events.filter((e) => e.type === "iteration-finished");
    expect(finished.map((e) => e.result)).toEqual(["failed:rate-limited"]);
    const state = readStateInCtx();
    expect(state.history.at(-1)?.result).toBe("failed:rate-limited");
  });

  test("stops with rateLimited on a fatal engine exit code (codex 42)", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok({ exitCode: 42 }));
    const { runner } = makeRunner(agent);

    expect(await runner.start()).toBe("rateLimited");
  });

  test("stops as completed when an external writer flips state.status away from active", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => {
      // Simulate an external writer (e.g. agent coordinator) blocking the task
      // mid-run. The runner must report it to the machine, whose
      // statusNotActive guard stops the loop.
      runWithContext(createDefaultContext({ layout: projectLayout(root) }), () => {
        const state = readState(stateDir);
        writeState(stateDir, { ...state, status: "blocked" });
      });
      return ok();
    });
    const { runner } = makeRunner(agent, { limits: { maxIterations: 10 } });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(agent.calls.length).toBe(1);
  });
});

describe("LoopRunner — completion and archive", () => {
  test("archives and stops completed when all tasks are checked off", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => {
      writeTasks(CHECKED_TASKS);
      return ok();
    });
    const store = fakeChangeStore();
    const { calls: gitCalls, git } = fakeGit();
    const { runner, events } = makeRunner(agent, {
      deps: { changeStore: store, git },
    });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(store.archived).toEqual([NAME]);
    expect(readStateInCtx().status).toBe("completed");
    expect(stoppedEvent(events).iterations).toBe(1);
    // Final commit + push happen because at least one iteration ran.
    expect(gitCalls.commits).toEqual([{ dir: tasksDir, message: `change ${NAME} finished` }]);
    expect(gitCalls.pushes).toBeGreaterThanOrEqual(1);
  });

  test("refuses to archive on a dirty worktree and stops stranded (LIT-303 guard)", async () => {
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore();
    const { git } = fakeGit(() => ["src/uncommitted.ts"]);
    const { runner, events } = makeRunner(agent, { deps: { changeStore: store, git } });

    const reason = await runner.start();

    expect(reason).toBe("stranded");
    expect(store.archived).toEqual([]);
    expect(agent.calls.length).toBe(0);
    expect(runner.getSnapshot().stopReason).toBe("stranded");
    const infos = events.filter((e) => e.type === "info").map((e) => e.text);
    expect(infos.some((t) => t.includes("refusing to archive"))).toBe(true);
  });

  test("archives when the only uncommitted change is a framework hook (.ralph-hooks)", async () => {
    // The litrpg incident: `.ralph-hooks/pre-push` is tracked on main, so
    // `installPrePushHook` re-writes it every setup and it shows as ` M`
    // forever. That framework noise must not strand the change. See LIT-303.
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore();
    const { git } = fakeGit(() => [" M .ralph-hooks/pre-push"]);
    const { runner } = makeRunner(agent, { deps: { changeStore: store, git } });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(store.archived).toEqual([NAME]);
    expect(readStateInCtx().status).toBe("completed");
  });

  test("still strands when a real worker file is dirty alongside a framework hook", async () => {
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore();
    const { git } = fakeGit(() => [" M .ralph-hooks/pre-push", " M src/real.ts"]);
    const { runner } = makeRunner(agent, { deps: { changeStore: store, git } });

    const reason = await runner.start();

    expect(reason).toBe("stranded");
    expect(store.archived).toEqual([]);
  });

  test("skips archive but still completes when openspec reports the change incomplete", async () => {
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore({
      getStatus: async () => ({
        changeName: NAME,
        isComplete: false,
        applyRequires: [],
        artifacts: [{ id: "design", status: "ready" }],
      }),
    });
    const { runner, events } = makeRunner(agent, { deps: { changeStore: store } });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(store.archived).toEqual([]);
    const infos = events.filter((e) => e.type === "info").map((e) => e.text);
    expect(infos.some((t) => t.includes("Archive skipped"))).toBe(true);
    // An incomplete status is an expected skip, never a failure (RLF-251).
    expect(infos.some((t) => t.startsWith("Archive failed for"))).toBe(false);
  });

  test("surfaces a thrown archive error with the change name and still completes", async () => {
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore({
      archiveChange: async () => {
        const detail = `openspec archive failed for "${NAME}" (exit 1)`;
        throw new Error(detail);
      },
    });
    const { runner, events } = makeRunner(agent, { deps: { changeStore: store } });

    const reason = await runner.start();

    // Control flow is unchanged — the loop still completes via ALL_TASKS_DONE.
    expect(reason).toBe("completed");
    const infos = events.filter((e) => e.type === "info").map((e) => e.text);
    const failure = infos.find((t) => t.startsWith(`Archive failed for "${NAME}":`));
    expect(failure).toBeDefined();
    expect(failure).toContain("(exit 1)");
  });

  test("exits when tasks.md is gone and the change was archived externally", async () => {
    // Resumed run (iteration > 0) with no tasks.md and the change absent from
    // the active list.
    runWithContext(createDefaultContext({ layout: projectLayout(root) }), () => {
      const state = buildInitialState({ name: NAME, prompt: "" });
      writeState(stateDir, { ...state, iteration: 3 });
    });
    const agent = fakeAgent(() => ok());
    const store = fakeChangeStore({ listChanges: async () => [] });
    const { runner } = makeRunner(agent, { deps: { changeStore: store } });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(agent.calls.length).toBe(0);
    expect(readStateInCtx().status).toBe("completed");
  });
});

describe("LoopRunner — review phase", () => {
  test("loops review rounds until clean, then archives", async () => {
    writeTasks(CHECKED_TASKS);
    const findingsPath = join(tasksDir, "review-findings.md");
    const agent = fakeAgent(
      () => {
        writeFileSync(findingsPath, "## Open\n\n- [ ] tighten error handling\n", "utf-8");
        return ok();
      },
      () => {
        writeFileSync(findingsPath, "## Open\n\n(no findings — close round)\n", "utf-8");
        return ok();
      },
    );
    const store = fakeChangeStore();
    const rounds: number[] = [];
    const { runner, events } = makeRunner(agent, {
      reviewPhase: { enabled: true, maxRounds: 3 },
      onReviewRound: async (result) => {
        rounds.push(result.openFindings);
      },
      deps: { changeStore: store },
    });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(agent.calls.length).toBe(2);
    expect(rounds).toEqual([1, 0]);
    const reviewEvents = events.filter((e) => e.type === "review-round");
    expect(reviewEvents.map((e) => e.result.roundNumber)).toEqual([1, 2]);
    expect(reviewEvents.map((e) => e.result.capReached)).toEqual([false, false]);
    expect(store.archived).toEqual([NAME]);
    // Reviewer prompts are review passes, not task iterations.
    expect(agent.calls[0]?.prompt).toContain("Self-Review Pass");
    expect(readStateInCtx().reviewRounds).toBe(2);
  });

  test("proceeds to done when the round cap is reached with open findings", async () => {
    writeTasks(CHECKED_TASKS);
    const findingsPath = join(tasksDir, "review-findings.md");
    const agent = fakeAgent(() => {
      writeFileSync(findingsPath, "## Open\n\n- [ ] never fixed\n", "utf-8");
      return ok();
    });
    const store = fakeChangeStore();
    const { runner, events } = makeRunner(agent, {
      reviewPhase: { enabled: true, maxRounds: 2 },
      deps: { changeStore: store },
    });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(agent.calls.length).toBe(2);
    const reviewEvents = events.filter((e) => e.type === "review-round");
    expect(reviewEvents.at(-1)?.result.capReached).toBe(true);
    expect(reviewEvents.at(-1)?.result.openFindings).toBe(1);
    expect(store.archived).toEqual([NAME]);
  });
});

describe("LoopRunner — steering", () => {
  test("steer mid-iteration aborts, resumes the session, and merges usage", async () => {
    writeTasks(UNCHECKED_TASKS);
    const { runner, events } = makeRunner(
      fakeAgent(
        (req) =>
          new Promise((resolve) => {
            // Hang until the steer abort arrives.
            req.signal?.addEventListener("abort", () =>
              resolve(ok({ usage: usage(1), sessionId: "session-1" })),
            );
            // Signal the test that the engine is mid-run.
            req.onFeedEvent({ type: "text", text: "working" });
          }),
        (req) => {
          // The resume request carries the session id and the steering prompt.
          expect(req.resumeSessionId).toBe("session-1");
          expect(req.prompt).toContain("LIVE STEERING UPDATE FROM USER");
          expect(req.prompt).toContain("use zod v4");
          // Session init events are noise on resume and must be filtered;
          // other events pass through.
          req.onFeedEvent({ type: "session", model: "opus", sessionId: "session-1" });
          req.onFeedEvent({ type: "session-unknown", sessionId: "session-1" });
          req.onFeedEvent({ type: "text", text: "resumed" });
          writeTasks(CHECKED_TASKS);
          return ok({ usage: usage(2) });
        },
      ),
    );

    let steered = false;
    runner.subscribe((event) => {
      if (!steered && event.type === "feed" && event.event.type === "text") {
        steered = true;
        runner.steer("use zod v4");
      }
    });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(events.some((e) => e.type === "steering-applied" && e.message === "use zod v4")).toBe(
      true,
    );
    const steering = await Bun.file(join(tasksDir, "steering.md")).text();
    expect(steering).toContain("use zod v4");
    // Usage from the aborted run and the resumed run are merged into one iteration.
    const state = readStateInCtx();
    expect(state.usage.total_cost_usd).toBe(3);
    expect(state.iteration).toBe(1);
    // Session init events from the resumed run were filtered out.
    const feedTypes = events.filter((e) => e.type === "feed").map((e) => e.event.type);
    expect(feedTypes).not.toContain("session-unknown");
    expect(feedTypes.filter((t) => t === "session").length).toBe(0);
    expect(feedTypes).toContain("text");
  });

  test("steer between iterations is queued into steering.md before the next prompt", async () => {
    writeTasks(UNCHECKED_TASKS);
    let steered = false;
    const { runner, events } = makeRunner(
      fakeAgent(
        () => ok({ sessionId: null }),
        (req) => {
          expect(req.prompt).toContain("focus on tests");
          writeTasks(CHECKED_TASKS);
          return ok();
        },
      ),
      { limits: { maxIterations: 5 } },
    );

    runner.subscribe((event) => {
      // After the first iteration finishes (no live session to resume),
      // the steer waits for the next iteration's prompt build.
      if (!steered && event.type === "iteration-finished") {
        steered = true;
        runner.steer("focus on tests");
      }
    });

    const reason = await runner.start();

    expect(reason).toBe("completed");
    expect(
      events.some((e) => e.type === "steering-applied" && e.message === "focus on tests"),
    ).toBe(true);
    const steering = await Bun.file(join(tasksDir, "steering.md")).text();
    expect(steering).toContain("focus on tests");
  });
});

describe("LoopRunner — lifecycle", () => {
  test("cancel mid-iteration aborts the engine and resolves cancelled without recording the iteration", async () => {
    writeTasks(UNCHECKED_TASKS);
    const { runner, events } = makeRunner(
      fakeAgent(
        (req) =>
          new Promise((resolve) => {
            req.signal?.addEventListener("abort", () => resolve(ok()));
            req.onFeedEvent({ type: "text", text: "working" });
          }),
      ),
    );

    runner.subscribe((event) => {
      if (event.type === "feed") runner.cancel();
    });

    const reason = await runner.start();

    expect(reason).toBe("cancelled");
    expect(stoppedEvent(events).reason).toBe("cancelled");
    expect(runner.getSnapshot().isRunning).toBe(false);
    // The aborted partial iteration is not recorded.
    expect(readStateInCtx().iteration).toBe(0);
  });

  test("stops with signal when a STOP file appears after an iteration", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => {
      writeFileSync(join(tasksDir, "STOP"), "stop requested", "utf-8");
      return ok();
    });
    const { runner } = makeRunner(agent, { limits: { maxIterations: 10 } });

    const reason = await runner.start();

    expect(reason).toBe("signal");
    expect(agent.calls.length).toBe(1);
    expect(readStateInCtx().status).toBe("blocked");
  });

  test("start() is idempotent — a second call returns the same run", async () => {
    writeTasks(CHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const { runner } = makeRunner(agent);

    const [first, second] = await Promise.all([runner.start(), runner.start()]);

    expect(first).toBe("completed");
    expect(second).toBe("completed");
    expect(agent.calls.length).toBe(0);
  });

  test("resumes from existing state: prior iterations count toward maxIterations", async () => {
    writeTasks(UNCHECKED_TASKS);
    runWithContext(createDefaultContext({ layout: projectLayout(root) }), () => {
      const state = buildInitialState({ name: NAME, prompt: "" });
      writeState(stateDir, { ...state, iteration: 4 });
    });
    const agent = fakeAgent(() => ok());
    const { runner, events } = makeRunner(agent, { limits: { maxIterations: 5 } });

    const reason = await runner.start();

    expect(reason).toBe("maxIterations");
    expect(agent.calls.length).toBe(1);
    expect(runner.getSnapshot().isResume).toBe(true);
    // Local iteration count is relative to this run.
    expect(stoppedEvent(events).iterations).toBe(1);
    const started = events.find((e) => e.type === "iteration-started");
    expect(started?.iteration).toBe(1);
    expect(started?.totalIteration).toBe(5);
  });

  test("salvages a malformed .ralph-state.json by reinitialising", async () => {
    writeTasks(CHECKED_TASKS);
    // Parseable JSON that fails schema validation — the shape an external
    // writer (e.g. linear-sync) leaves behind before the loop scaffolds a
    // full state object.
    writeFileSync(join(stateDir, ".ralph-state.json"), '{"linearComments": []}', "utf-8");
    const agent = fakeAgent(() => ok());
    const { runner, events } = makeRunner(agent);

    const reason = await runner.start();

    expect(reason).toBe("completed");
    const infos = events.filter((e) => e.type === "info").map((e) => e.text);
    expect(infos.some((t) => t.includes("malformed"))).toBe(true);
    expect(readStateInCtx().name).toBe(NAME);
  });

  test("rewrites engine/model on resume when they differ from the stored state", async () => {
    writeTasks(CHECKED_TASKS);
    runWithContext(createDefaultContext({ layout: projectLayout(root) }), () => {
      const state = buildInitialState({ name: NAME, prompt: "", model: "sonnet" });
      writeState(stateDir, state);
    });
    const agent = fakeAgent(() => ok());
    const { runner } = makeRunner(agent, { model: "opus" });

    await runner.start();

    expect(readStateInCtx().model).toBe("opus");
  });

  test("stops with error when the engine throws", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => {
      throw new Error("spawn failed");
    });
    const { runner, events } = makeRunner(agent, { limits: { maxIterations: 10 } });

    const reason = await runner.start();

    expect(reason).toBe("error");
    expect(stoppedEvent(events).reason).toBe("error");
    expect(agent.calls.length).toBe(1);
    const infos = events.filter((e) => e.type === "info").map((e) => e.text);
    expect(infos.some((t) => t.includes("Engine error"))).toBe(true);
  });

  test("uses the default sleep between iterations when none is injected", async () => {
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(
      () => ok(),
      () => {
        writeTasks(CHECKED_TASKS);
        return ok();
      },
    );
    const { git } = fakeGit();
    const runner = createLoopRunner({
      name: NAME,
      delaySeconds: 0.001,
      deps: { agent, layout: projectLayout(root), changeStore: fakeChangeStore(), git },
    });

    expect(await runner.start()).toBe("completed");
    expect(agent.calls.length).toBe(2);
  });

  test("start() rejects when no layout is injected and none is ambient", async () => {
    const runner = createLoopRunner({ name: NAME });
    expect(runner.start()).rejects.toThrow("no project layout available");
  });

  test("getSnapshot returns a stable reference between events", async () => {
    writeTasks(CHECKED_TASKS);
    const { runner } = makeRunner(fakeAgent(() => ok()));
    const before = runner.getSnapshot();
    expect(runner.getSnapshot()).toBe(before);
    await runner.start();
    const after = runner.getSnapshot();
    expect(after).not.toBe(before);
    expect(runner.getSnapshot()).toBe(after);
  });
});

describe("LoopRunner — telemetry surface", () => {
  // The runner replaced useLoop as the emitter of the loop.* bus events
  // (RLF-96 Stage 7 contract, relocated here by issue #401).
  test("emits the 5 loop.* bus events", async () => {
    const runnerDir = join(
      import.meta.dir.replace("/core/dist/", "/core/src/"),
      "..",
      "loop-runner",
    );
    const text = (
      await Promise.all([
        Bun.file(join(runnerDir, "index.ts")).text(),
        Bun.file(join(runnerDir, "runner-internals.ts")).text(),
      ])
    ).join("\n");
    for (const t of [
      "loop.task_started",
      "loop.task_stopped",
      "loop.iteration_failed",
      "loop.engine_rate_limited",
      "loop.engine_error",
    ]) {
      expect(text.includes(`type: "${t}"`)).toBe(true);
    }
  });

  test("stays headless — no React/Ink/WebSocket imports", async () => {
    const runnerDir = join(
      import.meta.dir.replace("/core/dist/", "/core/src/"),
      "..",
      "loop-runner",
    );
    const text = (
      await Promise.all([
        Bun.file(join(runnerDir, "index.ts")).text(),
        Bun.file(join(runnerDir, "runner-internals.ts")).text(),
      ])
    ).join("\n");
    expect(text.includes('from "react"')).toBe(false);
    expect(text.includes('from "ink"')).toBe(false);
    expect(text.includes('from "ws"')).toBe(false);
  });
});

describe("LoopRunner — planning-phase model/effort", () => {
  test("uses planModel/planEffort while in a planning phase (no proposal yet)", async () => {
    // No proposal.md → deriveOpenSpecPhase returns 'proposal' (a planning phase).
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const { runner } = makeRunner(agent, {
      model: "opus",
      planModel: "sonnet",
      planEffort: "low",
      limits: { maxIterations: 1 },
    });

    await runner.start();

    expect(agent.calls[0]?.model).toBe("sonnet");
    expect(agent.calls[0]?.effort).toBe("low");
  });

  test("uses the top-level model/effort during the implement phase", async () => {
    // Real proposal + design + unchecked tasks → phase 'implement'.
    writeFileSync(join(tasksDir, "proposal.md"), "# Proposal\n\nReal proposal body.\n", "utf-8");
    writeFileSync(join(tasksDir, "design.md"), "# Design\n\nReal design body.\n", "utf-8");
    writeTasks(UNCHECKED_TASKS);
    const agent = fakeAgent(() => ok());
    const { runner } = makeRunner(agent, {
      model: "opus",
      planModel: "sonnet",
      planEffort: "low",
      limits: { maxIterations: 1 },
    });

    await runner.start();

    expect(agent.calls[0]?.model).toBe("opus");
    expect(agent.calls[0]?.effort).toBeUndefined();
  });
});
