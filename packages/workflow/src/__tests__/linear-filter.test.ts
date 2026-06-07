import { describe, expect, it } from "bun:test";
import { resolveLinearFilter, applyAssigneeOverride } from "../linear-filter";

describe("resolveLinearFilter", () => {
  it("resolves an empty filter to no assignee constraint and no required labels", () => {
    expect(resolveLinearFilter([])).toEqual({ requireAllLabels: [] });
  });

  it("resolves assignee = me", () => {
    expect(resolveLinearFilter([{ type: "assignee", value: "me" }])).toEqual({
      assignee: "me",
      requireAllLabels: [],
    });
  });

  it("maps assignee = any to anyAssignee", () => {
    expect(resolveLinearFilter([{ type: "assignee", value: "any" }])).toEqual({
      anyAssignee: true,
      requireAllLabels: [],
    });
  });

  it("resolves assignee = unassigned (and a blank value) to unassigned", () => {
    expect(resolveLinearFilter([{ type: "assignee", value: "unassigned" }])).toEqual({
      assignee: "unassigned",
      requireAllLabels: [],
    });
    expect(resolveLinearFilter([{ type: "assignee", value: "" }])).toEqual({
      assignee: "unassigned",
      requireAllLabels: [],
    });
  });

  it("preserves email/user-id case and is case-insensitive on keywords", () => {
    expect(resolveLinearFilter([{ type: "assignee", value: "Dev@Example.com" }])).toEqual({
      assignee: "Dev@Example.com",
      requireAllLabels: [],
    });
    expect(resolveLinearFilter([{ type: "assignee", value: "AbC-123" }])).toEqual({
      assignee: "AbC-123",
      requireAllLabels: [],
    });
    expect(resolveLinearFilter([{ type: "assignee", value: "  ME  " }])).toEqual({
      assignee: "me",
      requireAllLabels: [],
    });
  });

  it("collects label clauses into requireAllLabels (deduped, order-preserving)", () => {
    expect(
      resolveLinearFilter([
        { type: "assignee", value: "me" },
        { type: "label", value: "ralph" },
        { type: "label", value: "backend" },
        { type: "label", value: "ralph" },
      ]),
    ).toEqual({ assignee: "me", requireAllLabels: ["ralph", "backend"] });
  });

  it("works with labels and no assignee clause", () => {
    expect(resolveLinearFilter([{ type: "label", value: "ralph" }])).toEqual({
      requireAllLabels: ["ralph"],
    });
  });

  it("throws when more than one assignee clause is present", () => {
    expect(() =>
      resolveLinearFilter([
        { type: "assignee", value: "me" },
        { type: "assignee", value: "any" },
      ]),
    ).toThrow(/at most one "assignee"/);
  });
});

describe("applyAssigneeOverride", () => {
  it("returns the filter unchanged for a blank override", () => {
    const filter = [
      { type: "assignee" as const, value: "me" },
      { type: "label" as const, value: "ralph" },
    ];
    expect(applyAssigneeOverride(filter, "")).toBe(filter);
    expect(applyAssigneeOverride(filter, "   ")).toBe(filter);
  });

  it("replaces the assignee clause and keeps label clauses", () => {
    expect(
      applyAssigneeOverride(
        [
          { type: "assignee", value: "me" },
          { type: "label", value: "ralph" },
        ],
        "any",
      ),
    ).toEqual([
      { type: "label", value: "ralph" },
      { type: "assignee", value: "any" },
    ]);
  });

  it("appends an assignee clause when none existed", () => {
    expect(applyAssigneeOverride([{ type: "label", value: "ralph" }], "dev@example.com")).toEqual([
      { type: "label", value: "ralph" },
      { type: "assignee", value: "dev@example.com" },
    ]);
  });
});
