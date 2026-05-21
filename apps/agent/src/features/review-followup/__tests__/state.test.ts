import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import type { StateStore } from "../../types";
import { advanceWatermarkIfNewer, writeWatermark } from "../state";
import { recordingBus } from "../../../__test-utils__/recording-bus";

function recordingState(): {
  state: StateStore;
  writes: { path: string; value: unknown }[];
} {
  const writes: { path: string; value: unknown }[] = [];
  return {
    writes,
    state: {
      writeField: async (path, value) => {
        writes.push({ path, value });
      },
    },
  };
}

describe("review-followup/state", () => {
  test("writeWatermark persists lastConsumedCommentAt to the review slot", async () => {
    const { state, writes } = recordingState();
    await writeWatermark(state, "2026-05-15T10:00:00Z");
    expect(writes).toEqual([
      { path: "review.lastConsumedCommentAt", value: "2026-05-15T10:00:00Z" },
    ]);
  });

  test("advance: writes + emits watermark-advanced when candidate is newer", async () => {
    const events: EmitInput[] = [];
    const { state, writes } = recordingState();
    const wrote = await advanceWatermarkIfNewer(
      state,
      recordingBus(events),
      "2026-05-15T10:00:00Z",
      "2026-05-15T12:00:00Z",
    );
    expect(wrote).toBe(true);
    expect(writes).toEqual([
      { path: "review.lastConsumedCommentAt", value: "2026-05-15T12:00:00Z" },
    ]);
    expect(events).toEqual([
      {
        type: "feature.review-followup.completed",
        outcome: "watermark-advanced",
        from: "2026-05-15T10:00:00Z",
        to: "2026-05-15T12:00:00Z",
      },
    ]);
  });

  test("advance: writes + emits when there is no prior watermark (null current)", async () => {
    const events: EmitInput[] = [];
    const { state, writes } = recordingState();
    const wrote = await advanceWatermarkIfNewer(
      state,
      recordingBus(events),
      null,
      "2026-05-15T12:00:00Z",
    );
    expect(wrote).toBe(true);
    expect(writes).toEqual([
      { path: "review.lastConsumedCommentAt", value: "2026-05-15T12:00:00Z" },
    ]);
    expect(events).toEqual([
      {
        type: "feature.review-followup.completed",
        outcome: "watermark-advanced",
        to: "2026-05-15T12:00:00Z",
      },
    ]);
  });

  test("skip: no write + emits watermark-unchanged when candidate equals current", async () => {
    const events: EmitInput[] = [];
    const { state, writes } = recordingState();
    const wrote = await advanceWatermarkIfNewer(
      state,
      recordingBus(events),
      "2026-05-15T10:00:00Z",
      "2026-05-15T10:00:00Z",
    );
    expect(wrote).toBe(false);
    expect(writes).toEqual([]);
    expect(events).toEqual([
      {
        type: "feature.review-followup.skipped",
        reason: "watermark-unchanged",
        at: "2026-05-15T10:00:00Z",
      },
    ]);
  });

  test("skip: no write + emits watermark-unchanged when candidate is older", async () => {
    const events: EmitInput[] = [];
    const { state, writes } = recordingState();
    const wrote = await advanceWatermarkIfNewer(
      state,
      recordingBus(events),
      "2026-05-15T10:00:00Z",
      "2026-05-14T09:00:00Z",
    );
    expect(wrote).toBe(false);
    expect(writes).toEqual([]);
    expect(events).toEqual([
      {
        type: "feature.review-followup.skipped",
        reason: "watermark-unchanged",
        at: "2026-05-15T10:00:00Z",
      },
    ]);
  });
});
