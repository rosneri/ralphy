import { describe, expect, test } from "bun:test";
import { waitForMergeability, DEFAULT_BACKOFFS_MS } from "../shared/pr/wait-for-mergeability";

const noSleep = async () => {};

describe("waitForMergeability", () => {
  test("returns mergeable on first MERGEABLE probe", async () => {
    let calls = 0;
    const outcome = await waitForMergeability({
      probe: async () => {
        calls++;
        return { state: "OPEN", mergeable: "MERGEABLE" };
      },
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "mergeable" });
    expect(calls).toBe(1);
  });

  test("returns conflicting on CONFLICTING", async () => {
    const outcome = await waitForMergeability({
      probe: async () => ({ state: "OPEN", mergeable: "CONFLICTING" }),
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "conflicting" });
  });

  test("returns closed when state flips to MERGED/CLOSED mid-poll", async () => {
    const seq = [
      { state: "OPEN", mergeable: "UNKNOWN" },
      { state: "MERGED", mergeable: "UNKNOWN" },
    ];
    let i = 0;
    const outcome = await waitForMergeability({
      probe: async () => seq[Math.min(i++, seq.length - 1)]!,
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "closed" });
  });

  test("UNKNOWN → MERGEABLE across retries", async () => {
    const seq = [
      { state: "OPEN", mergeable: "UNKNOWN" },
      { state: "OPEN", mergeable: "UNKNOWN" },
      { state: "OPEN", mergeable: "MERGEABLE" },
    ];
    let i = 0;
    const outcome = await waitForMergeability({
      probe: async () => seq[i++]!,
      backoffsMs: [0, 0, 0],
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "mergeable" });
    expect(i).toBe(3);
  });

  test("exhausts retries → unknown", async () => {
    let i = 0;
    const outcome = await waitForMergeability({
      probe: async () => {
        i++;
        return { state: "OPEN", mergeable: "UNKNOWN" };
      },
      backoffsMs: [0, 0, 0],
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "unknown" });
    // 3 backoffs + final attempt = 4 calls
    expect(i).toBe(4);
  });

  test("mergeStateStatus=CLEAN resolves before `mergeable` does", async () => {
    const outcome = await waitForMergeability({
      probe: async () => ({
        state: "OPEN",
        mergeable: "UNKNOWN",
        mergeStateStatus: "CLEAN",
      }),
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "mergeable" });
  });

  test("mergeStateStatus=DIRTY → conflicting even when mergeable=UNKNOWN", async () => {
    const outcome = await waitForMergeability({
      probe: async () => ({
        state: "OPEN",
        mergeable: "UNKNOWN",
        mergeStateStatus: "DIRTY",
      }),
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "conflicting" });
  });

  test("mergeStateStatus=BLOCKED (policy gate) → mergeable", async () => {
    // BLOCKED means required reviews/checks missing — not a merge conflict.
    const outcome = await waitForMergeability({
      probe: async () => ({
        state: "OPEN",
        mergeable: "UNKNOWN",
        mergeStateStatus: "BLOCKED",
      }),
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "mergeable" });
  });

  test("probe error with bailOnError=true → error outcome", async () => {
    const outcome = await waitForMergeability({
      probe: async () => {
        throw new Error("boom");
      },
      bailOnError: true,
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "error", message: "boom" });
  });

  test("probe error without bail → onError fires and loop continues", async () => {
    const seq: Array<() => Promise<{ state: string; mergeable: string }>> = [
      async () => {
        throw new Error("transient");
      },
      async () => ({ state: "OPEN", mergeable: "MERGEABLE" }),
    ];
    let i = 0;
    const errors: Error[] = [];
    const outcome = await waitForMergeability({
      probe: () => seq[i++]!(),
      onError: (e) => errors.push(e),
      backoffsMs: [0, 0],
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "mergeable" });
    expect(errors.map((e) => e.message)).toEqual(["transient"]);
  });

  test("DEFAULT_BACKOFFS_MS totals ≈31s across 5 retries", () => {
    expect(DEFAULT_BACKOFFS_MS.reduce((a, b) => a + b, 0)).toBe(31000);
    expect(DEFAULT_BACKOFFS_MS.length).toBe(5);
  });
});
