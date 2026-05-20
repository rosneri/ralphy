import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runAgentJson } from "../agent/json-runner";

let tempDir: string;
let originalApiKey: string | undefined;
let originalExitCode: number | undefined;
let writes: string[] = [];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "json-runner-preflight-test-"));
  mkdirSync(join(tempDir, "openspec"), { recursive: true });
  writeFileSync(join(tempDir, "package.json"), "{}");
  originalApiKey = process.env["LINEAR_API_KEY"];
  process.env["LINEAR_API_KEY"] = "test-key";
  originalExitCode = process.exitCode;
  writes = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — narrow override for tests
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
});

afterEach(() => {
  process.stdout.write = originalWrite;
  if (originalApiKey === undefined) delete process.env["LINEAR_API_KEY"];
  else process.env["LINEAR_API_KEY"] = originalApiKey;
  process.exitCode = originalExitCode;
  rmSync(tempDir, { recursive: true, force: true });
});

function parseEmittedEvents(): Array<Record<string, unknown>> {
  return writes
    .join("")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("runAgentJson preflight", () => {
  test("emits exactly one auth_failure event and exits 2 when preflight fails", async () => {
    await runAgentJson({
      // @ts-expect-error — minimal args fixture
      args: { maxTickets: 0 },
      projectRoot: tempDir,
      statesDir: join(tempDir, "states"),
      tasksDir: join(tempDir, "tasks"),
      runPreflight: async () => ({
        ok: false,
        tool: "gh",
        message: "gh is not authenticated. Run `gh auth login`",
      }),
    });

    expect(process.exitCode).toBe(2);
    const events = parseEmittedEvents();
    const authFailures = events.filter((e) => e.code === "auth_failure");
    expect(authFailures).toHaveLength(1);
    expect(authFailures[0]!.type).toBe("error");
    expect(authFailures[0]!.tool).toBe("gh");
    expect(authFailures[0]!.text).toContain("gh is not authenticated");

    // No started / poll events before the failure
    for (const e of events) {
      expect(e.type).not.toBe("started");
      expect(e.type).not.toBe("poll_start");
      expect(e.type).not.toBe("poll_done");
    }
  });
});
