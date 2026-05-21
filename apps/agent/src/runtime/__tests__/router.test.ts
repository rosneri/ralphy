import { describe, expect, it } from "bun:test";
import { ROUTER_TABLE, route } from "../router";
import type { RouterSignals } from "../types";

const baseline: RouterSignals = {
  bucket: "todo",
  prStatus: "none",
  awaiting: "none",
  mention: "none",
  stuck: false,
  boost: "p2",
};

const sig = (over: Partial<RouterSignals>): RouterSignals => ({ ...baseline, ...over });

describe("router precedence table", () => {
  it("row: awaiting → revise (via awaiting=revise)", () => {
    expect(route(sig({ awaiting: "revise" })).flowId).toBe("confirmation");
  });
  it("row: awaiting → revise (via mention=revise)", () => {
    expect(route(sig({ mention: "revise" })).flowId).toBe("confirmation");
  });
  it("row: awaiting → confirm", () => {
    expect(route(sig({ awaiting: "awaiting" })).flowId).toBe("confirmation");
  });
  it("row: pr conflicting (via prStatus)", () => {
    expect(route(sig({ prStatus: "conflicting" })).flowId).toBe("conflict-fix");
  });
  it("row: pr conflicting (via bucket)", () => {
    expect(route(sig({ bucket: "conflicted" })).flowId).toBe("conflict-fix");
  });
  it("row: pr ci failing", () => {
    expect(route(sig({ prStatus: "ci-failing" })).flowId).toBe("ci-fix");
  });
  it("row: review bucket", () => {
    expect(route(sig({ bucket: "review" })).flowId).toBe("review-followup");
  });
  it("row: stuck", () => {
    expect(route(sig({ stuck: true })).flowId).toBe("stuck");
  });
  it("row: new ticket", () => {
    expect(route(sig({ bucket: "todo", mention: "new-ticket" })).flowId).toBe("new-ticket");
  });
  it("row: mention catch-all", () => {
    expect(route(sig({ bucket: "done", mention: "stuck" })).flowId).toBe("mention");
  });
  it("row: in-progress implement", () => {
    expect(route(sig({ bucket: "in-progress" })).flowId).toBe("implement");
  });
  it("row: todo implement", () => {
    expect(route(sig({ bucket: "todo" })).flowId).toBe("implement");
  });
  it("row: idle catch-all", () => {
    expect(route(sig({ bucket: "done" })).flowId).toBe("idle");
  });
  it("last row is the idle catch-all so the function is total", () => {
    const last = ROUTER_TABLE[ROUTER_TABLE.length - 1]!;
    expect(last.flowId).toBe("idle");
    expect(last.when(sig({}))).toBe(true);
  });
  it("propagates boost band onto the assignment", () => {
    expect(route(sig({ boost: "p0", awaiting: "awaiting" })).boost).toBe("p0");
    expect(route(sig({ boost: "p3" })).boost).toBe("p3");
  });
});
