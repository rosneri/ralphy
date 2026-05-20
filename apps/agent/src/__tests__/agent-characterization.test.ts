/**
 * RLF-89 Stage-0 — Characterization tests (regression net).
 *
 * Pins observable behavior of `buildAgentCoordinator` + `coord.pollOnce()`
 * across seven scenarios using the same fake-harness pattern as
 * `agent-integration.test.ts`. Three scenarios are pinned with
 * `test.failing(...)` to encode bugs that Stage 2 will flip from red to
 * green by removing the `.failing` marker.
 *
 * Bun 1.3.14 supports `test.failing`, confirmed in the loop before this
 * file was authored. No `expect(...).toThrow()` fallback is needed.
 *
 * Scenarios (filled in across the loop, one per iteration):
 *   1. new ticket → approval → implement → done                  (green, goldens)
 *   2. new ticket → revise → design → approval → implement       (green)
 *   3. gated ticket + PR conflicted → conflict-fix wins          (test.failing)
 *   4. gated ticket + CI failing → ci-fix wins                   (test.failing)
 *   5. approval persisted + tasks reset for conflict-fix         (test.failing)
 *   6. round-cap exhaustion → stuck                              (green)
 *   7. finished + PR conflicting → conflict-fix                  (green)
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-char-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("agent characterization — Stage-0 regression net", () => {
  test("scaffold placeholder — file is discovered by `bun test agent-characterization`", () => {
    expect(tempDir).toContain("agent-char-");
  });
});
