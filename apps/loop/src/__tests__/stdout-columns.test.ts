import { describe, expect, test } from "bun:test";
import { applyWorkerColumnsOverride } from "../stdout-columns";

interface FakeStdout {
  isTTY?: boolean;
  columns?: number;
}

describe("applyWorkerColumnsOverride", () => {
  test("sets columns on a piped stdout from RALPH_WORKER_COLUMNS", () => {
    const stdout: FakeStdout = {};
    applyWorkerColumnsOverride(stdout, { RALPH_WORKER_COLUMNS: "172" });
    expect(stdout.columns).toBe(172);
  });

  test("does nothing when stdout is a TTY (real terminal width wins)", () => {
    const stdout: FakeStdout = { isTTY: true, columns: 120 };
    applyWorkerColumnsOverride(stdout, { RALPH_WORKER_COLUMNS: "172" });
    expect(stdout.columns).toBe(120);
  });

  test("does nothing when the variable is missing", () => {
    const stdout: FakeStdout = {};
    applyWorkerColumnsOverride(stdout, {});
    expect(stdout.columns).toBeUndefined();
  });

  test("ignores non-numeric and too-small values", () => {
    const nonNumeric: FakeStdout = {};
    applyWorkerColumnsOverride(nonNumeric, { RALPH_WORKER_COLUMNS: "wide" });
    expect(nonNumeric.columns).toBeUndefined();

    const tooSmall: FakeStdout = {};
    applyWorkerColumnsOverride(tooSmall, { RALPH_WORKER_COLUMNS: "5" });
    expect(tooSmall.columns).toBeUndefined();
  });
});
