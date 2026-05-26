import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initialWorkerSnapshot,
  readWorkerSnapshot,
  diffWorkerSnapshot,
  type WorkerSnapshot,
} from "../worker-state-poll";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "worker-state-poll-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("initialWorkerSnapshot", () => {
  test("returns the zero-valued snapshot", () => {
    expect(initialWorkerSnapshot()).toEqual({
      iter: 0,
      reviewRounds: 0,
      openspecPhase: null,
      currentTask: null,
      subtasks: [],
      taskProgress: null,
    });
  });
});

describe("readWorkerSnapshot", () => {
  test("missing state file + missing changeDir artifacts → snapshot mirrors prev (except openspecPhase derives 'proposal' from empty inputs)", async () => {
    const prev = initialWorkerSnapshot();
    const next = await readWorkerSnapshot({
      changeName: "c1",
      statesDir: tmp,
      changeDir: join(tmp, "missing"),
      prev,
    });
    expect(next.iter).toBe(0);
    expect(next.reviewRounds).toBe(0);
    expect(next.subtasks).toEqual([]);
    expect(next.taskProgress).toBeNull();
    expect(next.currentTask).toBeNull();
  });

  test("with a valid .ralph-state.json updates iter and reviewRounds", async () => {
    const stateDir = join(tmp, "c1");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, ".ralph-state.json"),
      JSON.stringify({ iteration: 7, reviewRounds: 2 }),
    );

    const next = await readWorkerSnapshot({
      changeName: "c1",
      statesDir: tmp,
      changeDir: "",
      prev: initialWorkerSnapshot(),
    });
    expect(next.iter).toBe(7);
    expect(next.reviewRounds).toBe(2);
  });

  test("malformed .ralph-state.json is swallowed and prev values are preserved", async () => {
    const stateDir = join(tmp, "c1");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, ".ralph-state.json"), "{ not valid json");

    const prev: WorkerSnapshot = {
      ...initialWorkerSnapshot(),
      iter: 4,
      reviewRounds: 1,
    };
    const next = await readWorkerSnapshot({
      changeName: "c1",
      statesDir: tmp,
      changeDir: "",
      prev,
    });
    expect(next.iter).toBe(4);
    expect(next.reviewRounds).toBe(1);
  });

  test("tasks.md is parsed into subtasks/currentTask/taskProgress", async () => {
    const changeDir = join(tmp, "change");
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, "tasks.md"), "- [x] one\n- [ ] two\n- [ ] three\n");

    const next = await readWorkerSnapshot({
      changeName: "c1",
      statesDir: tmp,
      changeDir,
      prev: initialWorkerSnapshot(),
    });
    expect(next.subtasks).toEqual([
      { done: true, text: "one" },
      { done: false, text: "two" },
      { done: false, text: "three" },
    ]);
    expect(next.currentTask).toBe("two");
    expect(next.taskProgress).toEqual({ checked: 1, total: 3 });
  });

  test("proposal+design+tasks together derive an openspecPhase", async () => {
    const changeDir = join(tmp, "change");
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, "proposal.md"), "# Proposal\n");
    await writeFile(join(changeDir, "design.md"), "# Design\n");
    await writeFile(join(changeDir, "tasks.md"), "- [ ] todo\n");

    const next = await readWorkerSnapshot({
      changeName: "c1",
      statesDir: tmp,
      changeDir,
      prev: initialWorkerSnapshot(),
    });
    expect(next.openspecPhase).not.toBeNull();
  });
});

describe("diffWorkerSnapshot", () => {
  test("no changes → empty event list", () => {
    const s = initialWorkerSnapshot();
    expect(diffWorkerSnapshot("c1", s, s)).toEqual([]);
  });

  test("iter change emits worker_iteration", () => {
    const prev = initialWorkerSnapshot();
    const next: WorkerSnapshot = { ...prev, iter: 5 };
    expect(diffWorkerSnapshot("c1", prev, next)).toEqual([
      { type: "worker_iteration", changeName: "c1", iter: 5 },
    ]);
  });

  test("reviewRounds change emits worker_review_rounds", () => {
    const prev = initialWorkerSnapshot();
    const next: WorkerSnapshot = { ...prev, reviewRounds: 3 };
    expect(diffWorkerSnapshot("c1", prev, next)).toEqual([
      { type: "worker_review_rounds", changeName: "c1", reviewRounds: 3 },
    ]);
  });

  test("openspecPhase change emits worker_openspec_phase", () => {
    const prev = initialWorkerSnapshot();
    const next: WorkerSnapshot = { ...prev, openspecPhase: "implement" };
    expect(diffWorkerSnapshot("c1", prev, next)).toEqual([
      { type: "worker_openspec_phase", changeName: "c1", phase: "implement" },
    ]);
  });

  test("currentTask change emits worker_current_task with progress", () => {
    const prev = initialWorkerSnapshot();
    const next: WorkerSnapshot = {
      ...prev,
      currentTask: "do the thing",
      taskProgress: { checked: 2, total: 5 },
    };
    expect(diffWorkerSnapshot("c1", prev, next)).toEqual([
      {
        type: "worker_current_task",
        changeName: "c1",
        task: "do the thing",
        progress: { checked: 2, total: 5 },
      },
    ]);
  });

  test("multiple changes emit multiple events in deterministic order", () => {
    const prev = initialWorkerSnapshot();
    const next: WorkerSnapshot = {
      ...prev,
      iter: 1,
      reviewRounds: 1,
      openspecPhase: "review",
      currentTask: "x",
    };
    const events = diffWorkerSnapshot("c1", prev, next);
    expect(events.map((e) => e["type"])).toEqual([
      "worker_iteration",
      "worker_review_rounds",
      "worker_openspec_phase",
      "worker_current_task",
    ]);
  });
});
