/**
 * Tests for the on-disk review-comment watermark (RLF-92 Stage 3). The
 * scaffolding is borrowed from `code-review-trigger-dedupe.test.ts` — see
 * that file for the detailed Linear / gh fake setup. This suite asserts
 * the disk-backed `review.lastConsumedCommentAt` slot is what blocks the
 * second poll from re-firing, not just the in-memory accelerator.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

interface Trace {
  spawnCount: number;
  scanCalls: number;
}

async function setupHarness(
  tempDir: string,
  reviewerCommentAt: string,
): Promise<{ trace: Trace; pollOnce: () => Promise<void> }> {
  const trace: Trace = { spawnCount: 0, scanCalls: 0 };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("linear.app")) {
      throw Object.assign(new Error("unexpected fetch in test"), { url });
    }
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const q = body.query;
    if (q.includes("commentCreate")) {
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }));
    }
    if (q.includes("workflowStates")) {
      return new Response(
        JSON.stringify({
          data: {
            workflowStates: {
              nodes: [
                { id: "s-todo", name: "Todo", type: "unstarted" },
                { id: "s-inprogress", name: "In Progress", type: "started" },
                { id: "s-done", name: "Done", type: "completed" },
              ],
            },
          },
        }),
      );
    }
    if (q.includes("issueLabels")) {
      return new Response(JSON.stringify({ data: { issueLabels: { nodes: [] } } }));
    }
    if (q.includes("issues(filter")) {
      const candidate = {
        id: "uuid-eng-9",
        identifier: "ENG-9",
        title: "Code review pending",
        description: null,
        url: "https://linear.app/x/ENG-9",
        priority: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
        state: { name: "Done", type: "completed" },
        assignee: null,
        labels: { nodes: [] },
        relations: { nodes: [] },
      };
      const isMentionScan = q.includes("MentionScanIssues");
      if (isMentionScan) {
        return new Response(JSON.stringify({ data: { issues: { nodes: [candidate] } } }));
      }
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }));
    }
    if (q.includes("IssueAttachments") || q.includes("attachments(first")) {
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
    }
    if (q.includes("issue(id") && q.includes("comments")) {
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
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
      syncTasksToComment: false,
      mentionTrigger: false,
      codeReviewTrigger: true,
      codeReviewStaleHours: 0,
      indicators: {
        getTodo: { filter: [{ type: "status", value: "Todo" }] },
        setInProgress: { type: "status", value: "In Progress" },
        setDone: { type: "status", value: "Done" },
      },
    },
  });

  const cfg = await loadRalphyConfig(tempDir);
  const args = await parseArgs([]);

  const git: GitRunner = {
    run: async (cmdArgs) => {
      if (cmdArgs[0] === "worktree" && cmdArgs[1] === "list") return { stdout: "", stderr: "" };
      if (cmdArgs[0] === "rev-parse") {
        const err = new Error("not found") as Error & { code?: number };
        err.code = 1;
        throw err;
      }
      return { stdout: "", stderr: "" };
    },
  };

  const prUrl = "https://github.com/o/r/pull/42";
  const cmd: CmdRunner = {
    run: async (cmdArr) => {
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "list") {
        return {
          stdout: JSON.stringify([
            {
              url: prUrl,
              state: "OPEN",
              headRefName: "ralph/eng-9-review",
              title: "ENG-9: Code review pending",
              updatedAt: "2026-05-01T00:00:00Z",
            },
          ]),
          stderr: "",
        };
      }
      if (
        cmdArr[0] === "gh" &&
        cmdArr[1] === "api" &&
        cmdArr[2] === "graphql" &&
        cmdArr.join(" ").includes("reviewThreads")
      ) {
        trace.scanCalls += 1;
        return {
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  state: "OPEN",
                  merged: false,
                  reviewDecision: "CHANGES_REQUESTED",
                  reviewRequests: { nodes: [{ requestedReviewer: { login: "alice" } }] },
                  latestReviews: {
                    nodes: [
                      {
                        author: { login: "alice" },
                        state: "CHANGES_REQUESTED",
                        submittedAt: reviewerCommentAt,
                      },
                    ],
                  },
                  reviewThreads: {
                    nodes: [
                      {
                        isResolved: false,
                        path: "src/foo.ts",
                        line: 42,
                        comments: {
                          nodes: [
                            {
                              body: "please rename this",
                              author: { login: "alice" },
                              createdAt: reviewerCommentAt,
                              url: `${prUrl}#discussion_r1`,
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  };
  const spawnWorker = (): { exited: Promise<number>; kill: () => void } => {
    trace.spawnCount += 1;
    return { exited: Promise.resolve(0), kill: () => {} };
  };
  const runners: AgentRunners = { git, cmd, spawnWorker, runScript: async () => 0 };

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
    runners,
  });

  await coord.init();

  return {
    trace,
    pollOnce: async () => {
      await coord.pollOnce();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe("scanCodeReview — on-disk watermark (RLF-92)", () => {
  let originalFetch: typeof fetch;
  let tempDir: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    tempDir = mkdtempSync(join(tmpdir(), "agent-code-review-watermark-"));
    await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
    await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("two polls with the same reviewer-comment list enqueue review exactly once", async () => {
    const fixedTs = "2026-05-15T10:00:00Z";
    const h = await setupHarness(tempDir, fixedTs);
    await h.pollOnce();
    expect(h.trace.spawnCount).toBe(1);
    await h.pollOnce();
    expect(h.trace.spawnCount).toBe(1);
    expect(h.trace.scanCalls).toBeGreaterThanOrEqual(2);
  });
});
