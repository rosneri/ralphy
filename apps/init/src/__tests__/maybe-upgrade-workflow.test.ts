import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeUpgradeWorkflow } from "../index";

/**
 * The interactive repair flow needs a TTY, so these cover the no-op guards that
 * keep `maybeUpgradeWorkflow` from launching a wizard in a non-interactive shell
 * (the test runner has no TTY). The actual init launch is exercised by hand.
 */
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "upgrade-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("maybeUpgradeWorkflow", () => {
  test("returns false when WORKFLOW.md does not exist", async () => {
    expect(await maybeUpgradeWorkflow(tempDir)).toBe(false);
  });

  test("returns false for a stale file in a non-interactive shell (in-memory heal applies)", async () => {
    // A v5 file with the removed string linear.filter — would launch init under
    // a TTY, but must not block work in a non-interactive shell.
    await Bun.write(
      join(tempDir, "WORKFLOW.md"),
      `---\nversion: 5\nlinear:\n  filter: assignee = me\n---\nbody\n`,
    );
    expect(await maybeUpgradeWorkflow(tempDir)).toBe(false);
  });
});
