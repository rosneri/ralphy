import { describe, expect, test } from "bun:test";
import { formatPrStatusMarker } from "../list";
import type { PrStatus } from "../pr-status";

const failStatus: PrStatus = {
  kind: "ok",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  ciBucket: "fail",
  autoMergeEnabled: false,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("formatPrStatusMarker", () => {
  test("renders expanded form when failedCheckNames is non-empty and ciBucket is fail", () => {
    expect(formatPrStatusMarker(failStatus, ["lint", "test"])).toBe("✗ci[lint, test]");
  });

  test("renders bare ✗ci when failedCheckNames is empty and ciBucket is fail", () => {
    expect(formatPrStatusMarker(failStatus, [])).toBe("✗ci");
  });

  test("renders bare ✗ci when failedCheckNames argument is omitted", () => {
    expect(formatPrStatusMarker(failStatus)).toBe("✗ci");
  });

  test("single failing check name renders correctly", () => {
    expect(formatPrStatusMarker(failStatus, ["unit-tests"])).toBe("✗ci[unit-tests]");
  });

  test("null status renders (no PR)", () => {
    expect(formatPrStatusMarker(null)).toBe("(no PR)");
    expect(formatPrStatusMarker(null, ["check"])).toBe("(no PR)");
  });

  test("non-fail ciBucket ignores failedCheckNames", () => {
    const pendingStatus: PrStatus = { ...failStatus, ciBucket: "pending" };
    expect(formatPrStatusMarker(pendingStatus, ["some-check"])).toBe("⏳ci");
  });

  test("passing PR renders ok", () => {
    const passStatus: PrStatus = { ...failStatus, ciBucket: "pass" };
    expect(formatPrStatusMarker(passStatus, ["check"])).toBe("ok");
  });
});
