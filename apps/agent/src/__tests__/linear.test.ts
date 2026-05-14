import { describe, expect, test } from "bun:test";
import { baseBranchFromLabels, issueMatchesGetIndicator } from "../agent/linear";

describe("baseBranchFromLabels", () => {
  test("returns the suffix when a ralph:branch:<name> label is present", () => {
    expect(baseBranchFromLabels(["ralph:branch:release/2026"])).toBe("release/2026");
  });

  test("prefix match is case-insensitive but suffix preserves casing", () => {
    expect(baseBranchFromLabels(["Ralph:Branch:Release-XYZ"])).toBe("Release-XYZ");
  });

  test("returns undefined when no matching label is present", () => {
    expect(baseBranchFromLabels(["ralph:review", "other"])).toBeUndefined();
    expect(baseBranchFromLabels([])).toBeUndefined();
  });

  test("trims whitespace and ignores empty suffix", () => {
    expect(baseBranchFromLabels(["ralph:branch:  feat-x  "])).toBe("feat-x");
    expect(baseBranchFromLabels(["ralph:branch:"])).toBeUndefined();
  });
});

describe("issueMatchesGetIndicator", () => {
  const issue = {
    labels: ["ralph:auto-merge"],
    state: { name: "In Progress", type: "started" },
  };

  test("returns false when indicator is undefined or empty", () => {
    expect(issueMatchesGetIndicator(issue, undefined)).toBe(false);
    expect(issueMatchesGetIndicator(issue, { filter: [] })).toBe(false);
  });

  test("matches against a label marker (case-insensitive)", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "label", value: "RALPH:AUTO-MERGE" }],
      }),
    ).toBe(true);
  });

  test("matches against a status marker", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "status", value: "in progress" }],
      }),
    ).toBe(true);
  });

  test("returns false when nothing matches", () => {
    expect(
      issueMatchesGetIndicator(issue, {
        filter: [{ type: "label", value: "ralph:review" }],
      }),
    ).toBe(false);
  });
});
