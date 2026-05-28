import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { agentRunStatePath, writeAgentRunState } from "../agent-run-state";

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "ralphy-agent-run-state-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  // Best-effort: clean up the `~/.ralph/<basename>/` dir we wrote into.
  const stateDir = join(homedir(), ".ralph", "ralphy-agent-run-state-test-fixture");
  rmSync(stateDir, { recursive: true, force: true });
});

describe("agentRunStatePath", () => {
  test("uses basename(projectRoot) under ~/.ralph", () => {
    const p = agentRunStatePath("/Users/neri/Developer/litrpg-new");
    expect(p).toBe(join(homedir(), ".ralph", "litrpg-new", "agent-state.json"));
  });

  test("stable for repeated calls (no timestamp suffixing)", () => {
    expect(agentRunStatePath("/foo/bar")).toBe(agentRunStatePath("/foo/bar"));
  });
});

describe("writeAgentRunState", () => {
  test("writes the state JSON with all fields populated", async () => {
    const projectRoot = join(homedir(), ".ralph-test-tmp", "ralphy-agent-run-state-test-fixture");
    await writeAgentRunState({
      projectRoot,
      configPath: join(projectRoot, "WORKFLOW.md"),
      team: "LIT",
      jsonLogFile: join(homedir(), ".Ralph", "agent-lit.jsonl"),
      startedAt: "2026-05-28T17:42:00.000Z",
      version: "3.8.14",
    });
    const path = agentRunStatePath(projectRoot);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(parsed["projectRoot"]).toBe(projectRoot);
    expect(parsed["configPath"]).toBe(join(projectRoot, "WORKFLOW.md"));
    expect(parsed["team"]).toBe("LIT");
    expect(parsed["jsonLogFile"]).toBe(join(homedir(), ".Ralph", "agent-lit.jsonl"));
    expect(parsed["startedAt"]).toBe("2026-05-28T17:42:00.000Z");
    expect(parsed["version"]).toBe("3.8.14");
  });

  test("records jsonLogFile as null when the agent was launched without --json-log-file", async () => {
    const projectRoot = join(homedir(), ".ralph-test-tmp", "ralphy-agent-run-state-test-fixture");
    await writeAgentRunState({
      projectRoot,
      configPath: join(projectRoot, "WORKFLOW.md"),
      team: undefined,
      jsonLogFile: null,
      startedAt: "2026-05-28T17:42:00.000Z",
      version: "3.8.14",
    });
    const parsed = JSON.parse(readFileSync(agentRunStatePath(projectRoot), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(parsed["jsonLogFile"]).toBeNull();
    expect(parsed["team"]).toBeUndefined();
  });
});
