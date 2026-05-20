import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runAgentJson } from "../agent/json-runner";

let tempDir: string;
let originalApiKey: string | undefined;
let originalExitCode: string | number | null | undefined;
let writes: string[] = [];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "json-runner-log-file-test-"));
  mkdirSync(join(tempDir, "openspec"), { recursive: true });
  writeFileSync(join(tempDir, "package.json"), "{}");
  originalApiKey = process.env["LINEAR_API_KEY"];
  process.env["LINEAR_API_KEY"] = "test-key";
  originalExitCode = process.exitCode;
  writes = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
  if (originalApiKey === undefined) delete process.env["LINEAR_API_KEY"];
  else process.env["LINEAR_API_KEY"] = originalApiKey;
  process.exitCode = originalExitCode ?? 0;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("runAgentJson --json-log-file", () => {
  test("mirrors auth_failure event to the configured file", async () => {
    const logPath = join(tempDir, "logs", "events.jsonl");
    await runAgentJson({
      // @ts-expect-error — minimal args fixture
      args: { maxTickets: 0, jsonLogFile: logPath },
      projectRoot: tempDir,
      statesDir: join(tempDir, "states"),
      tasksDir: join(tempDir, "tasks"),
      runPreflight: async () => ({
        ok: false,
        tool: "gh",
        message: "gh is not authenticated. Run `gh auth login`",
      }),
    });

    // The sink writes are serialized through an async chain; wait briefly so
    // queued appends flush before we read the file.
    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const authFailures = parsed.filter((e) => e.code === "auth_failure");
    expect(authFailures).toHaveLength(1);
    expect(authFailures[0]!.type).toBe("error");
    expect(authFailures[0]!.tool).toBe("gh");
    expect(typeof authFailures[0]!.ts).toBe("number");
  });

  test("no file is created when jsonLogFile is undefined", async () => {
    const logPath = join(tempDir, "logs", "events.jsonl");
    await runAgentJson({
      // @ts-expect-error — minimal args fixture
      args: { maxTickets: 0 },
      projectRoot: tempDir,
      statesDir: join(tempDir, "states"),
      tasksDir: join(tempDir, "tasks"),
      runPreflight: async () => ({
        ok: false,
        tool: "gh",
        message: "fail",
      }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(logPath)).toBe(false);
  });
});
