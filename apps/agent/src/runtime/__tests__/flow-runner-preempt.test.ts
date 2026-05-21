import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "@ralphy/events";
import { preempt, type FlowWorker } from "../flow-runner";
import type { FlowAssignment } from "../types";

const tmp = mkdtempSync(join(tmpdir(), "rlf95-preempt-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("flow-runner preempt", () => {
  it("SIGTERM → SIGKILL → teardown → persist (worker ignores SIGTERM)", async () => {
    // A subprocess that ignores SIGTERM, requiring SIGKILL.
    const script = `
      process.on("SIGTERM", () => { /* ignore */ });
      setTimeout(() => {}, 60000);
    `;
    const sub = Bun.spawn(["bun", "-e", script], {
      stdout: "ignore",
      stderr: "ignore",
    });

    const events: string[] = [];
    const teardownCalls: string[] = [];
    const persisted: { issueId: string; assignment: FlowAssignment }[] = [];

    const bus = createBus();
    bus.on("*", (e) => events.push(e.type));

    const worker: FlowWorker = {
      exited: sub.exited,
      kill: (sig) => sub.kill(sig === "SIGKILL" ? "SIGKILL" : "SIGTERM"),
    };

    const newAssignment: FlowAssignment = {
      flowId: "conflict-fix",
      reason: "pr conflicting",
      boost: "p1",
    };

    await preempt(
      {
        issueId: "ISS-1",
        from: "implement",
        worker,
        teardown: async (reason) => {
          teardownCalls.push(reason);
        },
        newAssignment,
      },
      {
        bus,
        graceMs: 200,
        persist: (issueId, assignment) => {
          persisted.push({ issueId, assignment });
        },
      },
    );

    // Process must be dead and the teardown + persist must have happened
    // in order, sandwiched by the two preempt events.
    expect(events[0]).toBe("runtime.preempt.started");
    expect(events.at(-1)).toBe("runtime.preempt.completed");
    expect(teardownCalls).toEqual(["cancelled"]);
    expect(persisted).toEqual([{ issueId: "ISS-1", assignment: newAssignment }]);
    expect(await worker.exited).toBeDefined();
  }, 10_000);

  it("graceful exit on SIGTERM skips the SIGKILL escalation", async () => {
    const sub = Bun.spawn(["bun", "-e", "setTimeout(() => {}, 60000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });

    const worker: FlowWorker = {
      exited: sub.exited,
      kill: (sig) => sub.kill(sig === "SIGKILL" ? "SIGKILL" : "SIGTERM"),
    };
    const persisted: unknown[] = [];

    await preempt(
      {
        issueId: "ISS-2",
        from: "implement",
        worker,
        newAssignment: { flowId: "ci-fix", reason: "pr ci failing", boost: "p2" },
      },
      {
        graceMs: 2000,
        persist: (_id, a) => {
          persisted.push(a);
        },
      },
    );
    expect(persisted).toHaveLength(1);
  }, 10_000);
});
