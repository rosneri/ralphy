import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { requiresWorker } from "../flow-runner";
import { runAwaitingCi } from "../../features/awaiting-ci/run";
import { recordingBus, makeBareCtx } from "../../__test-utils__/recording-bus";
import type { FeatureCtx } from "../../features/types";
import type { FlowAssignment } from "../types";

/**
 * Invariant: an `awaiting-ci` assignment must NEVER spawn a worker
 * subprocess. The coordinator decides this via `requiresWorker(flowId)`.
 * Three consecutive polls of an awaiting-ci assignment exercise the
 * `getCiStatus()` capability three times and the spy worker spawner
 * zero times.
 */
describe("runtime/awaiting-ci — no worker spawn", () => {
  test("requiresWorker('awaiting-ci') is false", () => {
    expect(requiresWorker("awaiting-ci")).toBe(false);
  });

  test("requiresWorker('implement') is true (control case)", () => {
    expect(requiresWorker("implement")).toBe(true);
  });

  test("three polls call getCiStatus thrice; spy worker spawner called zero times", async () => {
    const events: EmitInput[] = [];
    let spawnCount = 0;
    let getCount = 0;
    const spawnWorker = (): { exited: Promise<number>; kill: () => void } => {
      spawnCount += 1;
      return { exited: Promise.resolve(0), kill: () => {} };
    };

    const assignment: FlowAssignment = {
      flowId: "awaiting-ci",
      reason: "awaiting-ci watch",
      boost: "p2",
    };

    const base = makeBareCtx();
    const ctx: FeatureCtx = {
      ...base,
      bus: recordingBus(events),
      caps: {
        ...base.caps,
        ciFix: {
          getCiStatus: async () => {
            getCount += 1;
            return "pending";
          },
        },
      },
    };

    for (let i = 0; i < 3; i += 1) {
      if (requiresWorker(assignment.flowId)) {
        spawnWorker();
      } else {
        await runAwaitingCi(ctx);
      }
    }

    expect(spawnCount).toBe(0);
    expect(getCount).toBe(3);
    expect(events.length).toBe(3);
    for (const e of events) {
      expect(e.type).toBe("feature.awaiting-ci.completed");
    }
  });
});
