/**
 * Tests for the in-process dedupe of the GitHub code-review trigger
 * (`scanCodeReview` in `apps/agent/src/agent/wire.ts`).
 *
 * Scenarios mirror the spec delta at
 * `openspec/changes/rlf-59-review-loop-stuck/specs/agent-code-review-trigger/spec.md`:
 *
 *   (a) `postComments: false` — same reviewer comment fires once across two polls.
 *   (b) A newer reviewer comment at `T2 > T1` still fires.
 *   (c) Linear pickup-comment post failure does not cause a re-fire loop.
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

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

interface Handlers {
  /** ISO timestamp of the newest unresolved reviewer comment to advertise. */
  reviewerCommentAt: () => string;
  /** Toggle so we can flip the timestamp between polls in scenario (b). */
  postComments?: boolean;
  /** When true, the Linear `commentCreate` mutation returns a GraphQL error. */
  failOnCommentCreate?: boolean;
}

interface TraceCounters {
  scanCalls: number;
  pickupCommentBodies: string[];
  spawnCount: number;
}

interface Harness {
  trace: TraceCounters;
  pollOnce: () => Promise<void>;
}

async function setupHarness(tempDir: string, handlers: Handlers): Promise<Harness> {
  const trace: TraceCounters = {
    scanCalls: 0,
    pickupCommentBodies: [],
    spawnCount: 0,
  };

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
      if (handlers.failOnCommentCreate) {
        return new Response(JSON.stringify({ errors: [{ message: "linear is down" }] }), {
          status: 200,
        });
      }
      trace.pickupCommentBodies.push(body.variables.body as string);
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
      // No prior @ralphy mentions and no pickup comment — the mention branches
      // are silent; only `scanCodeReview` should drive the trigger.
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
      postComments: handlers.postComments ?? false,
      // Off so the sticky tasks comment doesn't fire when scaffolding runs
      // on the review-mode resume path (this test only cares about
      // pickup-comment dedupe, not comment-sync output).
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
      // PR discovery via `gh pr list --search ... --json url,state,...`.
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
      // PR review-state graphql lookup.
      if (
        cmdArr[0] === "gh" &&
        cmdArr[1] === "api" &&
        cmdArr[2] === "graphql" &&
        (cmdArr.join(" ").includes("reviewThreads") || cmdArr.join(" ").includes("pullRequest"))
      ) {
        trace.scanCalls += 1;
        const ts = handlers.reviewerCommentAt();
        const payload = {
          data: {
            repository: {
              pullRequest: {
                state: "OPEN",
                merged: false,
                reviewDecision: "CHANGES_REQUESTED",
                reviewRequests: { nodes: [{ requestedReviewer: { login: "alice" } }] },
                latestReviews: {
                  nodes: [
                    { author: { login: "alice" }, state: "CHANGES_REQUESTED", submittedAt: ts },
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
                            createdAt: ts,
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
        };
        return { stdout: JSON.stringify(payload), stderr: "" };
      }
      // Any other gh api call (e.g. pr-status checks) returns empty.
      return { stdout: "", stderr: "" };
    },
  };
  const spawnWorker = (workerCmd: string[]): { exited: Promise<number>; kill: () => void } => {
    void workerCmd;
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
      // Let microtasks (post-prepare comment/spawn chain) flush.
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe("scanCodeReview — in-process dedupe (RLF-59)", () => {
  let originalFetch: typeof fetch;
  let tempDir: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    tempDir = mkdtempSync(join(tmpdir(), "agent-code-review-dedupe-"));
    await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
    await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("same reviewer comment fires once across two polls when postComments is false", async () => {
    const fixedTs = "2026-05-15T10:00:00Z";
    const h = await setupHarness(tempDir, {
      postComments: false,
      reviewerCommentAt: () => fixedTs,
    });
    await h.pollOnce();
    const afterFirst = h.trace.spawnCount;
    await h.pollOnce();
    expect(afterFirst).toBe(1);
    expect(h.trace.spawnCount).toBe(1);
    // Confirm both polls actually reached scanCodeReview (i.e. the second
    // poll did do the PR review-state fetch but the dedupe map suppressed it).
    expect(h.trace.scanCalls).toBeGreaterThanOrEqual(2);
    // postComments is false → no Linear pickup comment was the sentinel.
    expect(h.trace.pickupCommentBodies).toEqual([]);
  });

  test("a newer reviewer comment at T2 > T1 still triggers", async () => {
    let ts = "2026-05-15T10:00:00Z";
    const h = await setupHarness(tempDir, {
      postComments: false,
      reviewerCommentAt: () => ts,
    });
    await h.pollOnce();
    expect(h.trace.spawnCount).toBe(1);
    ts = "2026-05-15T11:30:00Z";
    await h.pollOnce();
    expect(h.trace.spawnCount).toBe(2);
  });

  test("Linear pickup-comment post failure does not cause a re-fire loop", async () => {
    const fixedTs = "2026-05-15T10:00:00Z";
    const h = await setupHarness(tempDir, {
      postComments: true,
      failOnCommentCreate: true,
      reviewerCommentAt: () => fixedTs,
    });
    await h.pollOnce();
    expect(h.trace.spawnCount).toBe(1);
    await h.pollOnce();
    // Even though the Linear pickup-comment failed (so `lastRalphPickup`
    // remains null on the second poll), the in-process map blocks re-fire.
    expect(h.trace.spawnCount).toBe(1);
  });
});
