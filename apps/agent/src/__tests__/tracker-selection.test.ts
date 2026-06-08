/**
 * RLF-234: `tracker.kind` selects the issue-tracker provider in `wire.ts`.
 *
 * `tracker.kind: github` must drive the loop off the `gh` CLI (through the
 * shared cmdRunner) and never touch the Linear API; the default / `linear`
 * kind must keep querying Linear and never shell out to `gh issue`.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { parseAgentArgs as parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "rlf234-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

/** A cmdRunner that records gh invocations and returns empty issue lists. */
function recordingCmd(): { cmd: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const cmd: CmdRunner = {
    run: async (c) => {
      calls.push(c);
      if (c[1] === "issue" && c[2] === "list") return { stdout: "[]", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

describe("tracker.kind selection", () => {
  test("kind: github polls via gh and never calls the Linear API", async () => {
    let linearCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("linear.app")) linearCalled = true;
      throw Object.assign(new Error("unexpected fetch in github mode"), { url });
    }) as typeof fetch;

    await writeWorkflow(tempDir, {
      concurrency: 1,
      useWorktree: false,
      createPrOnSuccess: false,
      tracker: { kind: "github" },
      github: {
        issues: {
          repo: "acme/widgets",
          label: "ralph:todo",
          statusLabels: {
            inProgress: "ralph:in-progress",
            done: "ralph:done",
            error: "ralph:error",
          },
        },
      },
    });
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);
    const { cmd, calls } = recordingCmd();

    const { coord, filterDesc } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "unused-in-github-mode",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners: {
        git,
        cmd,
        spawnWorker: () => ({ exited: Promise.resolve(0), kill: () => {} }),
        runScript: async () => 0,
      } satisfies AgentRunners,
    });

    await coord.init();
    await coord.pollOnce();
    for (let i = 0; i < 5; i++) await tick();

    expect(linearCalled).toBe(false);
    const ghIssueList = calls.filter((c) => c[0] === "gh" && c[1] === "issue" && c[2] === "list");
    expect(ghIssueList.length).toBeGreaterThan(0);
    // The configured todo label scopes the pickup fetch.
    expect(ghIssueList.some((c) => c.includes("--label") && c.includes("ralph:todo"))).toBe(true);
    expect(typeof filterDesc).toBe("string");
  });

  test("absent tracker block keeps the Linear path (queries Linear, no gh issue calls)", async () => {
    let linearQueried = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) throw new Error("unexpected non-linear fetch");
      linearQueried = true;
      const body = JSON.parse(init?.body as string) as { query: string };
      if (body.query.includes("issues(filter")) {
        return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }));
      }
      return new Response(JSON.stringify({ data: {} }));
    }) as typeof fetch;

    await writeWorkflow(tempDir, {
      concurrency: 1,
      useWorktree: false,
      createPrOnSuccess: false,
      linear: {
        team: "ENG",
        postComments: false,
        updateEveryIterations: 0,
        indicators: {
          getTodo: { filter: [{ type: "status", value: "Todo" }] },
          setInProgress: { type: "status", value: "In Progress" },
          setDone: { type: "status", value: "Done" },
          setError: { type: "label", value: "ralph:error" },
        },
      },
    });
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.tracker.kind).toBe("linear");
    const args = await parseArgs([]);
    const { cmd, calls } = recordingCmd();

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners: {
        git,
        cmd,
        spawnWorker: () => ({ exited: Promise.resolve(0), kill: () => {} }),
        runScript: async () => 0,
      } satisfies AgentRunners,
    });

    await coord.init();
    await coord.pollOnce();
    for (let i = 0; i < 5; i++) await tick();

    expect(linearQueried).toBe(true);
    const ghIssueCalls = calls.filter((c) => c[0] === "gh" && c[1] === "issue");
    expect(ghIssueCalls).toHaveLength(0);
  });
});
