import { describe, expect, test } from "bun:test";
import { createBus } from "../bus";
import type { FeaturePhase, RalphEvent } from "../types";

const FEATURE_IDS = [
  "confirmation",
  "conflict-fix",
  "ci-fix",
  "implement",
  "review-followup",
  "new-ticket",
  "mention",
  "stuck",
] as const;

const PHASES: readonly FeaturePhase[] = ["detected", "started", "completed", "failed", "skipped"];

describe("feature bus events", () => {
  test("Bus.emit accepts every (feature, phase) literal", () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));

    const expected: string[] = [];
    for (const id of FEATURE_IDS) {
      for (const phase of PHASES) {
        const type = `feature.${id}.${phase}` as RalphEvent["type"];
        expected.push(type);
        bus.emit({ type, reason: "test" } as Parameters<typeof bus.emit>[0]);
      }
    }

    expect(seen).toEqual(expected);
    expect(seen).toHaveLength(FEATURE_IDS.length * PHASES.length);
  });

  test("wildcard handler observes feature event variants", () => {
    const bus = createBus();
    let last: RalphEvent | undefined;
    bus.on("*", (e) => {
      last = e;
    });
    bus.emit({ type: "feature.confirmation.detected", reason: "gate" });
    expect(last?.type).toBe("feature.confirmation.detected");
  });
});
