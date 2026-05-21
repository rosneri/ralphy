import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "@ralphy/events";
import { runCapability } from "../run-capability";
import { fsChange } from "../fs-change";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fs-change-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("fsChange.scaffold", () => {
  test("writes proposal/tasks/design and is idempotent on re-run", async () => {
    const changeDir = join(root, "changes", "foo");
    const stateDir = join(root, "states", "foo");
    const args = {
      changeDir,
      stateDir,
      proposal: "# Proposal\n",
      tasks: "# Tasks\n\n- [ ] do thing\n",
      design: "# Design\n",
    };

    await runCapability(fsChange.scaffold, args);
    await runCapability(fsChange.scaffold, args);

    expect(await Bun.file(join(changeDir, "proposal.md")).text()).toBe("# Proposal\n");
    expect(await Bun.file(join(changeDir, "tasks.md")).text()).toContain("- [ ] do thing");
    expect(await Bun.file(join(changeDir, "design.md")).text()).toBe("# Design\n");
  });

  test("emits scaffold lifecycle events on the bus", async () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    await runCapability(
      fsChange.scaffold,
      {
        changeDir: join(root, "changes", "bar"),
        stateDir: join(root, "states", "bar"),
        proposal: "p",
        tasks: "t",
        design: "d",
      },
      { bus },
    );
    expect(seen).toEqual(["fs.change.scaffold.started", "fs.change.scaffold.fetched"]);
  });
});

describe("fsChange.prependTask", () => {
  test("places the new directive before the existing first task", async () => {
    const tasksPath = join(root, "tasks.md");
    await Bun.write(tasksPath, "# Tasks\n\n## Earlier\n\n- [ ] first existing task\n");

    await runCapability(fsChange.prependTask, {
      tasksPath,
      heading: "Fix the broken thing",
      failureOutput: "boom",
    });

    const out = await Bun.file(tasksPath).text();
    const idxNew = out.indexOf("Fix the broken thing");
    const idxOld = out.indexOf("first existing task");
    expect(idxNew).toBeGreaterThanOrEqual(0);
    expect(idxOld).toBeGreaterThan(idxNew);
    expect(out).toContain("```\nboom\n```");
  });
});

describe("fsChange.appendSteering", () => {
  test("creates steering.md with a trailing newline when missing", async () => {
    const changeDir = join(root, "change");
    await Bun.write(join(changeDir, ".keep"), "");
    await runCapability(fsChange.appendSteering, { changeDir, message: "first note" });
    expect(await Bun.file(join(changeDir, "steering.md")).text()).toBe("first note\n");
  });

  test("prepends newest-first separated by a blank line", async () => {
    const changeDir = join(root, "change");
    await Bun.write(join(changeDir, "steering.md"), "older note\n");

    await runCapability(fsChange.appendSteering, { changeDir, message: "newer note" });

    const out = await Bun.file(join(changeDir, "steering.md")).text();
    expect(out).toBe("newer note\n\nolder note\n");
  });
});
