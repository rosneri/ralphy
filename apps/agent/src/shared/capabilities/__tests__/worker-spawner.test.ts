import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "@ralphy/events";
import { runCapability } from "../run-capability";
import { spawnWorker, workerSpawnEnvironment, type WorkerSpawner } from "../worker-spawner";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "worker-spawner-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("workerSpawnEnvironment", () => {
  test("passes the parent terminal width to the worker, minus the card chrome margin", () => {
    const environment = workerSpawnEnvironment(180, { PATH: "/usr/bin" });
    expect(environment["RALPH_WORKER_COLUMNS"]).toBe("170");
    expect(environment["PATH"]).toBe("/usr/bin");
  });

  test("never goes below the 40-column floor", () => {
    const environment = workerSpawnEnvironment(30, {});
    expect(environment["RALPH_WORKER_COLUMNS"]).toBe("40");
  });

  test("omits the variable when the parent has no measurable width", () => {
    const environment = workerSpawnEnvironment(undefined, { PATH: "/usr/bin" });
    expect(environment["RALPH_WORKER_COLUMNS"]).toBeUndefined();
    expect(environment["PATH"]).toBe("/usr/bin");
  });
});

describe("worker-spawner capability", () => {
  test("invokes the injected spawner and surfaces its handle", async () => {
    const calls: { cmd: string[]; cwd: string }[] = [];
    const spawn: WorkerSpawner = (cmd, cwd) => {
      calls.push({ cmd, cwd });
      return { exited: Promise.resolve(0), kill: () => {}, pid: 4242 };
    };
    const handle = await runCapability(spawnWorker, {
      cmd: ["bun", "ralph", "loop", "task", "--name", "eng-1"],
      cwd: root,
      changeName: "eng-1",
      spawn,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toEqual(["bun", "ralph", "loop", "task", "--name", "eng-1"]);
    expect(calls[0]!.cwd).toBe(root);
    expect(handle.pid).toBe(4242);
    expect(await handle.exited).toBe(0);
  });

  test("runs steering / prepend hooks before spawning", async () => {
    const changeDir = join(root, "openspec", "changes", "eng-1");
    const tasksPath = join(changeDir, "tasks.md");
    await rm(changeDir, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(changeDir, { recursive: true });
    await writeFile(tasksPath, "## Existing\n\n- [ ] thing\n", "utf8");

    const order: string[] = [];
    const spawn: WorkerSpawner = () => {
      order.push("spawn");
      return { exited: Promise.resolve(0), kill: () => {} };
    };
    await runCapability(spawnWorker, {
      cmd: ["bun", "ralph"],
      cwd: root,
      changeName: "eng-1",
      spawn,
      steeringNote: { changeDir, message: "note one" },
      prependTask: { tasksPath, heading: "Resolve PR merge conflicts", failureOutput: "body" },
    });

    const steeringContents = await readFile(join(changeDir, "steering.md"), "utf8");
    expect(steeringContents).toContain("note one");
    const tasksContents = await readFile(tasksPath, "utf8");
    expect(tasksContents).toContain("## Resolve PR merge conflicts");
    expect(tasksContents.indexOf("## Resolve PR merge conflicts")).toBeLessThan(
      tasksContents.indexOf("## Existing"),
    );
    expect(order).toEqual(["spawn"]);
  });

  test("emits worker.spawn.started + worker.spawn.fetched on success", async () => {
    const bus = createBus();
    const events: string[] = [];
    bus.on("*", (e) => {
      events.push(e.type as string);
    });
    const spawn: WorkerSpawner = () => ({ exited: Promise.resolve(0), kill: () => {} });
    await runCapability(
      spawnWorker,
      { cmd: ["echo"], cwd: root, changeName: "eng-1", spawn },
      { bus },
    );
    expect(events).toContain("worker.spawn.started");
    expect(events).toContain("worker.spawn.fetched");
    expect(events).not.toContain("worker.spawn.failed");
  });

  test("default spawner shells out to Bun.spawn when args.spawn is omitted", async () => {
    const handle = await runCapability(spawnWorker, {
      cmd: ["bun", "-e", "process.exit(0)"],
      cwd: root,
      changeName: "eng-1",
    });
    expect(typeof handle.pid === "number" || handle.pid === undefined).toBe(true);
    expect(await handle.exited).toBe(0);
  });

  test("default spawner kill() terminates a running subprocess", async () => {
    const handle = await runCapability(spawnWorker, {
      cmd: ["bun", "-e", "await new Promise(() => {})"],
      cwd: root,
      changeName: "eng-1",
    });
    expect(typeof handle.pid).toBe("number");
    handle.kill();
    const code = await handle.exited;
    expect(typeof code).toBe("number");
  });

  test("emits worker.spawn.failed and rethrows when the spawner throws", async () => {
    const bus = createBus();
    const events: string[] = [];
    bus.on("*", (e) => {
      events.push(e.type as string);
    });
    const spawn: WorkerSpawner = () => {
      throw new Error("spawn boom");
    };
    let captured: unknown;
    try {
      await runCapability(
        spawnWorker,
        { cmd: ["echo"], cwd: root, changeName: "eng-1", spawn },
        { bus },
      );
    } catch (err) {
      captured = err;
    }
    expect((captured as Error).message).toBe("spawn boom");
    expect(events).toContain("worker.spawn.started");
    expect(events).toContain("worker.spawn.failed");
  });
});
