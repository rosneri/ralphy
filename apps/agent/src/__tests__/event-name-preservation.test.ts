import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { recordingBus } from "../__test-utils__/recording-bus";
import {
  emitCompleted as emitAwaitingCiCompleted,
  emitFailed as emitAwaitingCiFailed,
} from "../features/awaiting-ci/events";
import { emitTransitioned as emitImplementTransitioned } from "../features/implement/events";

/**
 * Event-name preservation: the three new event types introduced by the
 * awaiting-ci split must use exactly these names so PostHog dashboards
 * and downstream consumers see no schema drift. Renaming any of these
 * is a breaking change.
 */
describe("event names — awaiting-ci split", () => {
  test("emits feature.awaiting-ci.completed verbatim", () => {
    const events: EmitInput[] = [];
    emitAwaitingCiCompleted(recordingBus(events), "pass");
    expect(events).toEqual([{ type: "feature.awaiting-ci.completed", outcome: "pass" }]);
  });

  test("emits feature.awaiting-ci.failed verbatim", () => {
    const events: EmitInput[] = [];
    emitAwaitingCiFailed(recordingBus(events), "ci-failing");
    expect(events).toEqual([{ type: "feature.awaiting-ci.failed", error: "ci-failing" }]);
  });

  test("emits feature.implement.transitioned verbatim", () => {
    const events: EmitInput[] = [];
    emitImplementTransitioned(recordingBus(events), "awaiting-ci");
    expect(events).toEqual([{ type: "feature.implement.transitioned", to: "awaiting-ci" }]);
  });
});
