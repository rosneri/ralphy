/**
 * Regression test for RLF-52.
 *
 * When the worker appends a new `## Implementation` section to
 * `tasks.md` with items already pre-checked (`- [x]`), the post-iteration
 * step must rewrite them back to `- [ ]` and emit a yellow warning. Items
 * inside sections that already existed in `tasks.md` before the worker
 * ran must be left alone.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
  tempDir = mkdtempSync(join(tmpdir(), "rlf52-"));
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

function installLinearStub(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("linear.app")) {
      throw Object.assign(new Error("unexpected fetch in test"), { url });
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
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }
    if (q.includes("issueAddLabel")) {
      return new Response(JSON.stringify({ data: { issueAddLabel: { success: true } } }));
    }
    if (q.includes("commentCreate")) {
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
}

describe("wire — RLF-52: normalizeNewlyAppendedSection runs after each worker iteration", () => {
  test("worker appends `## Implementation` with all `[x]` items → file rewritten, warning logged", async () => {
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

    const tasksPath = join(tempDir, "openspec", "changes", "eng-1-add-dark-mode", "tasks.md");

    // Fake worker: when invoked, append `## Implementation` with pre-checked
    // items to the mission tasks.md, then exit cleanly. Mimics the failure
    // mode RLF-52 fixes.
    const spawnWorker = (
      _cmd: string[],
      _cwd: string,
    ): { exited: Promise<number>; kill: () => void } => {
      const exited = (async (): Promise<number> => {
        const existing = await Bun.file(tasksPath).text();
        const appended =
          existing.trimEnd() +
          "\n\n## Implementation\n\n- [x] step one\n- [x] step two\n- [X] step three\n";
        await Bun.write(tasksPath, appended);
        return 0;
      })();
      return { exited, kill: () => {} };
    };

    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
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
    // Allow the spawnWorker IIFE → post-task pipeline to settle.
    for (let i = 0; i < 20; i++) await tick();

    const finalContent = readFileSync(tasksPath, "utf-8");
    expect(finalContent).toContain("## Implementation");
    expect(finalContent).toContain("- [ ] step one");
    expect(finalContent).toContain("- [ ] step two");
    expect(finalContent).toContain("- [ ] step three");
    expect(finalContent).not.toMatch(/- \[[xX]\] step (one|two|three)/);

    const warning = logs.find(
      (l) =>
        l.color === "yellow" &&
        /normalized .* pre-checked item/i.test(l.text) &&
        /Implementation/.test(l.text),
    );
    expect(warning).toBeDefined();
  });
});
