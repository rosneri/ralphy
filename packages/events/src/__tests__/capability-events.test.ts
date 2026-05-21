import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import type { RalphEvent } from "../types";

describe("capability bus events", () => {
  test("Bus.emit accepts capability event literals", () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));

    bus.emit({ type: "linear.tickets.fetch.started" });
    bus.emit({ type: "linear.tickets.fetch.fetched", count: 3 });
    bus.emit({ type: "linear.tickets.fetch.failed", error: "boom" });
    bus.emit({ type: "gh.pr.view.started" });
    bus.emit({ type: "gh.pr.view.fetched" });
    bus.emit({ type: "gh.pr.view.failed", error: "x" });
    bus.emit({ type: "git.worktree.created", cwd: "/tmp/wt" });
    bus.emit({ type: "git.worktree.removed", cwd: "/tmp/wt" });
    bus.emit({ type: "git.worktree.failed", error: "y" });
    bus.emit({ type: "fs.change.scaffolded", changeName: "c" });
    bus.emit({ type: "fs.change.task.prepended", changeName: "c" });
    bus.emit({ type: "fs.change.steering.appended", changeName: "c" });
    bus.emit({ type: "worker.spawned", changeName: "c", pid: 42 });

    expect(seen).toEqual([
      "linear.tickets.fetch.started",
      "linear.tickets.fetch.fetched",
      "linear.tickets.fetch.failed",
      "gh.pr.view.started",
      "gh.pr.view.fetched",
      "gh.pr.view.failed",
      "git.worktree.created",
      "git.worktree.removed",
      "git.worktree.failed",
      "fs.change.scaffolded",
      "fs.change.task.prepended",
      "fs.change.steering.appended",
      "worker.spawned",
    ]);
  });

  test("wildcard handler types observe the capability event variants", () => {
    const bus = createBus();
    let last: RalphEvent | undefined;
    bus.on("*", (e) => {
      last = e;
    });
    bus.emit({ type: "fs.change.scaffolded", changeName: "abc" });
    expect(last?.type).toBe("fs.change.scaffolded");
  });
});
