import { describe, expect, test } from "bun:test";
import { assignTier, sortRows, type SortableRow } from "../list-sort";
import type { PrStatus, PrStatusOk } from "../pr-status";

function ok(overrides: Partial<PrStatusOk> = {}): PrStatus {
  return {
    kind: "ok",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    ciBucket: "pass",
    autoMergeEnabled: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("assignTier", () => {
  test("tier 1: conflict + auto-merge", () => {
    expect(assignTier(ok({ mergeable: "CONFLICTING", autoMergeEnabled: true }))).toBe(1);
  });
  test("tier 2: failing CI + auto-merge", () => {
    expect(assignTier(ok({ ciBucket: "fail", autoMergeEnabled: true }))).toBe(2);
  });
  test("tier 3: conflict only", () => {
    expect(assignTier(ok({ mergeable: "CONFLICTING" }))).toBe(3);
  });
  test("tier 4: failing CI only", () => {
    expect(assignTier(ok({ ciBucket: "fail" }))).toBe(4);
  });
  test("tier 5: clean PR", () => {
    expect(assignTier(ok())).toBe(5);
  });
  test("tier 5: pending CI", () => {
    expect(assignTier(ok({ ciBucket: "pending" }))).toBe(5);
  });
  test("tier 5: draft conflicted PR with no auto-merge stays in tier 3 (conflict trumps draft)", () => {
    // Draft doesn't change tiering — only conflict + auto-merge / CI fail matter.
    expect(assignTier(ok({ isDraft: true, mergeable: "CONFLICTING" }))).toBe(3);
  });
  test("tier 5: errored gh", () => {
    expect(assignTier({ kind: "error", message: "boom" })).toBe(5);
  });
  test("tier 5: no PR", () => {
    expect(assignTier(null)).toBe(5);
  });
  test("conflict + auto-merge wins over fail + auto-merge", () => {
    expect(
      assignTier(ok({ mergeable: "CONFLICTING", ciBucket: "fail", autoMergeEnabled: true })),
    ).toBe(1);
  });
});

describe("sortRows", () => {
  test("orders rows by tier first", () => {
    const rows: SortableRow[] = [
      { identifier: "A-5", status: ok(), bucketOrder: 0, issueCreatedAt: "" }, // tier 5
      { identifier: "A-4", status: ok({ ciBucket: "fail" }), bucketOrder: 0, issueCreatedAt: "" }, // tier 4
      {
        identifier: "A-3",
        status: ok({ mergeable: "CONFLICTING" }),
        bucketOrder: 0,
        issueCreatedAt: "",
      }, // tier 3
      {
        identifier: "A-2",
        status: ok({ ciBucket: "fail", autoMergeEnabled: true }),
        bucketOrder: 0,
        issueCreatedAt: "",
      },
      {
        identifier: "A-1",
        status: ok({ mergeable: "CONFLICTING", autoMergeEnabled: true }),
        bucketOrder: 0,
        issueCreatedAt: "",
      },
    ];
    const sorted = sortRows(rows).map((r) => r.identifier);
    expect(sorted).toEqual(["A-1", "A-2", "A-3", "A-4", "A-5"]);
  });

  test("within a tier, older createdAt comes first", () => {
    const rows: SortableRow[] = [
      {
        identifier: "X-2",
        status: ok({ mergeable: "CONFLICTING", createdAt: "2026-05-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "",
      },
      {
        identifier: "X-1",
        status: ok({ mergeable: "CONFLICTING", createdAt: "2026-04-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "",
      },
      {
        identifier: "X-3",
        status: ok({ mergeable: "CONFLICTING", createdAt: "2026-06-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "",
      },
    ];
    const sorted = sortRows(rows).map((r) => r.identifier);
    expect(sorted).toEqual(["X-1", "X-2", "X-3"]);
  });

  test("within a tier, older issueCreatedAt comes first (FIFO)", () => {
    const rows: SortableRow[] = [
      {
        identifier: "Y-2",
        status: ok({ createdAt: "2026-05-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "2026-04-01T00:00:00Z",
      },
      {
        identifier: "Y-1",
        status: ok({ createdAt: "2026-05-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "2026-02-01T00:00:00Z",
      },
      {
        identifier: "Y-3",
        status: ok({ createdAt: "2026-05-01T00:00:00Z" }),
        bucketOrder: 0,
        issueCreatedAt: "2026-06-01T00:00:00Z",
      },
    ];
    const sorted = sortRows(rows).map((r) => r.identifier);
    expect(sorted).toEqual(["Y-1", "Y-2", "Y-3"]);
  });

  test("no-PR rows fall back to bucketOrder for stable ordering", () => {
    const rows: SortableRow[] = [
      { identifier: "Z-3", status: null, bucketOrder: 2, issueCreatedAt: "" },
      { identifier: "Z-1", status: null, bucketOrder: 0, issueCreatedAt: "" },
      { identifier: "Z-2", status: null, bucketOrder: 1, issueCreatedAt: "" },
    ];
    const sorted = sortRows(rows).map((r) => r.identifier);
    expect(sorted).toEqual(["Z-1", "Z-2", "Z-3"]);
  });

  test("identifier is the final tie-breaker", () => {
    const rows: SortableRow[] = [
      { identifier: "B-2", status: null, bucketOrder: 0, issueCreatedAt: "" },
      { identifier: "B-1", status: null, bucketOrder: 0, issueCreatedAt: "" },
    ];
    const sorted = sortRows(rows).map((r) => r.identifier);
    expect(sorted).toEqual(["B-1", "B-2"]);
  });

  test("does not mutate the input array", () => {
    const rows: SortableRow[] = [
      { identifier: "B-2", status: null, bucketOrder: 1, issueCreatedAt: "" },
      { identifier: "B-1", status: null, bucketOrder: 0, issueCreatedAt: "" },
    ];
    const before = rows.map((r) => r.identifier);
    sortRows(rows);
    expect(rows.map((r) => r.identifier)).toEqual(before);
  });
});
