import { describe, expect, test } from "bun:test";
import { buildBuckets } from "../list";
import type { Indicators } from "@ralphy/types";

const errorMarker = { type: "label" as const, value: "ralph:error" };
const doneMarker = { type: "label" as const, value: "ralph:done" };
const todoFilter = [{ type: "label" as const, value: "ralph:todo" }];
const inProgressFilter = [{ type: "label" as const, value: "ralph:in-progress" }];
const autoMergeFilter = [{ type: "label" as const, value: "ralph:auto-merge" }];

describe("buildBuckets", () => {
  test("in-progress bucket excludes setError markers when setError is defined", () => {
    const indicators: Indicators = {
      getTodo: { filter: todoFilter },
      getInProgress: { filter: inProgressFilter },
      setError: errorMarker,
    };
    const buckets = buildBuckets(indicators);
    const inProgress = buckets.find((b) => b.label === "in-progress")!;
    expect(inProgress.exclude).toContainEqual(errorMarker);
  });

  test("in-progress bucket has empty exclude when setError is undefined", () => {
    const indicators: Indicators = {
      getTodo: { filter: todoFilter },
      getInProgress: { filter: inProgressFilter },
    };
    const buckets = buildBuckets(indicators);
    const inProgress = buckets.find((b) => b.label === "in-progress")!;
    expect(inProgress.exclude).toEqual([]);
  });

  test("todo bucket excludes both setDone and setError markers", () => {
    const indicators: Indicators = {
      getTodo: { filter: todoFilter },
      setDone: doneMarker,
      setError: errorMarker,
    };
    const buckets = buildBuckets(indicators);
    const todo = buckets.find((b) => b.label === "todo")!;
    expect(todo.exclude).toContainEqual(doneMarker);
    expect(todo.exclude).toContainEqual(errorMarker);
  });

  test("auto-merge bucket has empty exclude", () => {
    const indicators: Indicators = {
      getAutoMerge: { filter: autoMergeFilter },
      setError: errorMarker,
      setDone: doneMarker,
    };
    const buckets = buildBuckets(indicators);
    const autoMerge = buckets.find((b) => b.label === "auto-merge")!;
    expect(autoMerge.exclude).toEqual([]);
  });
});
