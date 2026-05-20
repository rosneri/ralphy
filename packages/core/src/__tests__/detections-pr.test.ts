import { describe, expect, test } from "bun:test";
import { detectPrState } from "../detections/pr";

describe("detectPrState", () => {
  test("merged PR with stale CONFLICTING mergeable → clean", () => {
    expect(detectPrState({ state: "MERGED", mergeable: "CONFLICTING" })).toBe("clean");
  });
  test("open + CONFLICTING → conflicting", () => {
    expect(detectPrState({ state: "OPEN", mergeable: "CONFLICTING" })).toBe("conflicting");
  });
  test("open + MERGEABLE → clean", () => {
    expect(detectPrState({ state: "OPEN", mergeable: "MERGEABLE" })).toBe("clean");
  });
  test("missing fields → unknown", () => {
    expect(detectPrState({})).toBe("unknown");
  });
  test("UNKNOWN mergeable → unknown", () => {
    expect(detectPrState({ state: "OPEN", mergeable: "UNKNOWN" })).toBe("unknown");
  });
  test("mergeStateStatus DIRTY → conflicting", () => {
    expect(detectPrState({ state: "OPEN", mergeStateStatus: "DIRTY" })).toBe("conflicting");
  });
});
