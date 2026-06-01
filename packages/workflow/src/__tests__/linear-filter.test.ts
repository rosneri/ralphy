import { describe, expect, it } from "bun:test";
import { parseLinearFilter } from "../linear-filter";

describe("parseLinearFilter", () => {
  it("defaults a blank filter to assignee = me", () => {
    expect(parseLinearFilter("")).toEqual({ assignee: "me" });
    expect(parseLinearFilter("   ")).toEqual({ assignee: "me" });
  });

  it("parses assignee = me", () => {
    expect(parseLinearFilter("assignee = me")).toEqual({ assignee: "me" });
  });

  it("maps assignee = any to anyAssignee", () => {
    expect(parseLinearFilter("assignee = any")).toEqual({ anyAssignee: true });
  });

  it("parses assignee = unassigned", () => {
    expect(parseLinearFilter("assignee = unassigned")).toEqual({ assignee: "unassigned" });
  });

  it("treats a blank value as unassigned (legacy meaning)", () => {
    expect(parseLinearFilter("assignee =")).toEqual({ assignee: "unassigned" });
  });

  it("parses an email value, preserving its original case", () => {
    expect(parseLinearFilter("assignee = Dev@Example.com")).toEqual({
      assignee: "Dev@Example.com",
    });
  });

  it("parses a user-id value, preserving its original case", () => {
    expect(parseLinearFilter("assignee = AbC-123")).toEqual({ assignee: "AbC-123" });
  });

  it("is case-insensitive on the key and tolerant of whitespace", () => {
    expect(parseLinearFilter("  ASSIGNEE   =   ME  ")).toEqual({ assignee: "me" });
    expect(parseLinearFilter("Assignee=any")).toEqual({ anyAssignee: true });
  });

  it("throws naming an unrecognized key", () => {
    expect(() => parseLinearFilter("priority = high")).toThrow(/priority/);
  });

  it("throws when no '=' is present", () => {
    expect(() => parseLinearFilter("assignee me")).toThrow(/expected/);
  });
});
