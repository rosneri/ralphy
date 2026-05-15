/**
 * Regression test for RLF-39.
 *
 * When `useWorktree: true` is configured but `createWorktree()` fails, the
 * agent MUST NOT silently fall back to the project root. Previously the
 * failure was swallowed and the worker ran inside the developer's main
 * checkout, corrupting the working tree.
 *
 * The test drives `coord.pollOnce()` end-to-end with a `GitRunner` whose
 * `run()` rejects on the first call. It asserts that:
 *   - no worker is spawned in the project root,
 *   - no scaffold is created under `<projectRoot>/openspec/changes/`,
 *   - the failure is logged in red (not yellow).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "rlf39-"));
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

/** Minimal Linear GraphQL stub — returns one Todo issue and accepts the
 *  status/label mutations the coordinator will fire. */
function installLinearStub(): { mutations: { kind: string }[] } {
  const mutations: { kind: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("linear.app")) {
      throw new Error(`unexpected fetch in test: ${url}`);
    }
    const body = JSON.parse(init?.body as string) as { query: string };
    const q = body.query;
    if (q.includes("issues(filter")) {
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-eng-1",
                  identifier: "ENG-1",
                  title: "Add dark mode",
                  description: "Users want dark mode",
                  url: "https://linear.app/x/ENG-1",
                  priority: 3,
                  state: { name: "Todo", type: "unstarted" },
                  assignee: null,
                  labels: { nodes: [] },
                  relations: { nodes: [] },
                },
              ],
            },
          },
        }),
      );
    }
    if (q.includes("workflowStates")) {
      return new Response(
        JSON.stringify({
          data: {
            workflowStates: {
              nodes: [
                { id: "state-todo", name: "Todo", type: "unstarted" },
                { id: "state-inprogress", name: "In Progress", type: "started" },
                { id: "state-done", name: "Done", type: "completed" },
              ],
            },
          },
        }),
      );
    }
    if (q.includes("issueLabels")) {
      return new Response(JSON.stringify({ data: { issueLabels: { nodes: [] } } }));
    }
    if (q.includes("issueUpdate")) {
      mutations.push({ kind: "issueUpdate" });
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }
    if (q.includes("issueAddLabel")) {
      mutations.push({ kind: "issueAddLabel" });
      return new Response(JSON.stringify({ data: { issueAddLabel: { success: true } } }));
    }
    if (q.includes("commentCreate")) {
      mutations.push({ kind: "commentCreate" });
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }));
    }
    if (q.includes("IssueAttachments") || q.includes("attachments(first")) {
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
    }
    if (q.includes("issue(id")) {
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
    }
    return new Response(JSON.stringify({ data: {} }));
  }) as typeof fetch;
  return { mutations };
}

describe("setupWorktree — RLF-39: worktree creation failure must not fall back to projectRoot", () => {
  test("useWorktree:true + createWorktree throws → no scaffold lands in projectRoot, red log emitted", async () => {
    installLinearStub();

    await writeWorkflow(tempDir, {
      concurrency: 1,
      useWorktree: true,
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
    const args = await parseArgs([]);

    const workersSpawned: string[] = [];
    const spawnWorker = (
      cmd: string[],
      cwd: string,
    ): { exited: Promise<number>; kill: () => void } => {
      workersSpawned.push(`${cwd}::${cmd.join(" ")}`);
      return { exited: Promise.resolve(0), kill: () => {} };
    };

    // GitRunner that rejects every call — simulates total worktree-creation
    // failure (e.g. `git worktree list` exiting nonzero on a corrupted repo).
    const git: GitRunner = {
      run: async () => {
        throw new Error("simulated git failure");
      },
    };
    const cmdRunner: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

    const logs: { text: string; color: string | undefined }[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text, color) => logs.push({ text, color }),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners: {
        git,
        cmd: cmdRunner,
        spawnWorker,
        runScript: async () => 0,
      } satisfies AgentRunners,
    });

    await coord.init();
    await coord.pollOnce();
    await tick();
    await tick();

    // No scaffold landed in the project root — this is the load-bearing
    // invariant. Before the fix, ENG-1's proposal/tasks would have been
    // written into <tempDir>/openspec/changes/eng-1-add-dark-mode/.
    expect(
      existsSync(join(tempDir, "openspec", "changes", "eng-1-add-dark-mode", "tasks.md")),
    ).toBe(false);
    expect(
      existsSync(join(tempDir, "openspec", "changes", "eng-1-add-dark-mode", "proposal.md")),
    ).toBe(false);

    // No worker was spawned (would have run inside projectRoot).
    expect(workersSpawned.length).toBe(0);

    // The failure surfaces in red, with the new "useWorktree is required"
    // skip message — not the old yellow "falling back to project root".
    const redLogs = logs.filter((l) => l.color === "red");
    expect(redLogs.some((l) => /worktree create failed/i.test(l.text))).toBe(true);
    expect(
      logs.some((l) => l.color === "yellow" && /falling back to project root/i.test(l.text)),
    ).toBe(false);
  });

  test("useWorktree:false preserves projectRoot fallback when no worktree is created", async () => {
    installLinearStub();

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
    const args = await parseArgs([]);

    let spawnCwd: string | null = null;
    const spawnWorker = (
      _cmd: string[],
      cwd: string,
    ): { exited: Promise<number>; kill: () => void } => {
      spawnCwd = cwd;
      return { exited: Promise.resolve(0), kill: () => {} };
    };

    // GitRunner is never called for useWorktree:false; throwing here would
    // surface as a clear failure if that contract regresses.
    const git: GitRunner = {
      run: async () => {
        throw new Error("git runner should not be called when useWorktree is false");
      },
    };
    const cmdRunner: CmdRunner = { run: async () => ({ stdout: "", stderr: "" }) };

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
        cmd: cmdRunner,
        spawnWorker,
        runScript: async () => 0,
      } satisfies AgentRunners,
    });

    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(spawnCwd).toBe(tempDir);
  });
});
