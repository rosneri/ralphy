import { describe, expect, test } from "bun:test";
import { issueMatchesGetIndicator } from "../shared/capabilities/linear-client";
import { mergeIndicators } from "../agent/wire/indicators";

const baseIssue = {
  labels: [] as string[],
  state: { name: "Todo", type: "unstarted" },
  project: null as null | { id: string; name: string },
};

describe("indicators S7 — issueMatchesGetIndicator filter semantics", () => {
  test("S7.1: label-only filter returns false for status-only issue (no labels)", () => {
    const issue = { ...baseIssue, state: { name: "Todo", type: "unstarted" }, labels: [] };
    expect(
      issueMatchesGetIndicator(issue, { filter: [{ type: "label", value: "ralph:todo" }] }),
    ).toBe(false);
  });

  test("S7.2: OR semantics — matching one element in the filter is sufficient", () => {
    const issue = {
      ...baseIssue,
      labels: ["A"],
      state: { name: "X", type: "unstarted" },
    };
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [
          { type: "label", value: "A" },
          { type: "status", value: "B" },
        ],
      }),
    ).toBe(true);
  });

  test("S7.3: issue matching both getTodo and getInProgress filters appears in both", () => {
    const getTodo = { filter: [{ type: "label" as const, value: "ralph:todo" }] };
    const getInProgress = { filter: [{ type: "status" as const, value: "In Progress" }] };
    const issue = {
      labels: ["ralph:todo"],
      state: { name: "In Progress", type: "started" },
      project: null,
    };
    expect(issueMatchesGetIndicator(issue, getTodo)).toBe(true);
    expect(issueMatchesGetIndicator(issue, getInProgress)).toBe(true);
  });

  test("S7.6: mergeIndicators CLI replaces config key entirely (no concatenation)", () => {
    const cfg = { getTodo: { filter: [{ type: "label" as const, value: "cfg-label" }] } };
    const cli = { getTodo: { filter: [{ type: "status" as const, value: "cli-status" }] } };
    const result = mergeIndicators(cfg, cli);
    expect(result.getTodo?.filter).toEqual([{ type: "status", value: "cli-status" }]);
    expect(result.getTodo?.filter.some((m) => m.value === "cfg-label")).toBe(false);
  });

  test("RLF-214: mergeIndicators carries setPrReady from config", () => {
    const cfg = { setPrReady: { type: "status" as const, value: "In Review" } };
    const result = mergeIndicators(cfg, {});
    expect(result.setPrReady).toEqual({ type: "status", value: "In Review" });
  });

  test("RLF-214: mergeIndicators CLI override carries setPrReady", () => {
    const cfg = { setPrReady: { type: "status" as const, value: "Config Review" } };
    const cli = { setPrReady: { type: "label" as const, value: "ralphy:pr-ready" } };
    const result = mergeIndicators(cfg, cli);
    expect(result.setPrReady).toEqual({ type: "label", value: "ralphy:pr-ready" });
  });
});
