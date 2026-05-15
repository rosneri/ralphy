/**
 * Tests for the read-confirmed (`👀` reaction) wiring inside `fetchMentions`:
 *
 *   1. Slug mapping helper (`githubReactionSlug`) returns the GitHub content
 *      slug for the unicode emoji we send.
 *   2. When a Linear comment mentions @ralphy on a Done issue, the agent
 *      issues a `reactionCreate` mutation for that comment.
 *   3. When `reactionCreate` itself throws, the mention is still surfaced
 *      (the queued review work runs).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, githubReactionSlug, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

describe("githubReactionSlug", () => {
  test("maps 👀 to eyes", () => {
    expect(githubReactionSlug("👀")).toBe("eyes");
  });
  test("maps known thumbs", () => {
    expect(githubReactionSlug("👍")).toBe("+1");
    expect(githubReactionSlug("👎")).toBe("-1");
  });
  test("passes through unknown glyphs", () => {
    expect(githubReactionSlug("🦀")).toBe("🦀");
  });
});

interface FakeFetchHandlers {
  /** Optionally fail when handling a `reactionCreate` mutation. */
  failOnReaction?: boolean;
}

interface TestSetup {
  reactionCalls: { commentId: string; emoji: string }[];
  pickupCommentBodies: string[];
}

async function runMentionPoll(tempDir: string, handlers: FakeFetchHandlers): Promise<TestSetup> {
  const reactionCalls: { commentId: string; emoji: string }[] = [];
  const pickupCommentBodies: string[] = [];

  // The agent will iterate via `bun cli.js task --name <change>` which we
  // stub. The Done-state issue carries one @ralphy comment newer than any
  // pickup; fetchMentions should react to it and enqueue a review run.
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
    if (q.includes("reactionCreate")) {
      if (handlers.failOnReaction) {
        return new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 });
      }
      reactionCalls.push({
        commentId: body.variables.commentId as string,
        emoji: body.variables.emoji as string,
      });
      return new Response(JSON.stringify({ data: { reactionCreate: { success: true } } }));
    }
    if (q.includes("commentCreate")) {
      pickupCommentBodies.push(body.variables.body as string);
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
      // Done-state lookup: return the one done issue when the filter is
      // asking for it by name; everything else gets [].
      const serialized = JSON.stringify(body.variables.filter ?? {});
      const isDone = serialized.includes('"Done"');
      const nodes = isDone
        ? [
            {
              id: "uuid-eng-7",
              identifier: "ENG-7",
              title: "Shipped task",
              description: null,
              url: "https://linear.app/x/ENG-7",
              priority: 3,
              createdAt: "2026-01-01T00:00:00.000Z",
              state: { name: "Done", type: "completed" },
              assignee: null,
              labels: { nodes: [] },
              relations: { nodes: [] },
            },
          ]
        : [];
      return new Response(JSON.stringify({ data: { issues: { nodes } } }));
    }
    if (q.includes("IssueAttachments") || q.includes("attachments(first")) {
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
    }
    if (q.includes("issue(id") && q.includes("comments")) {
      // fetchIssueComments — return one @ralphy mention.
      return new Response(
        JSON.stringify({
          data: {
            issue: {
              comments: {
                nodes: [
                  {
                    id: "comment-id-42",
                    body: "@ralphy please retry",
                    createdAt: "2026-05-15T10:00:00Z",
                    user: { name: "alice", email: null },
                  },
                ],
              },
            },
          },
        }),
      );
    }
    return new Response(JSON.stringify({ data: {} }));
  }) as typeof fetch;

  await writeWorkflow(tempDir, {
    concurrency: 1,
    useWorktree: false,
    createPrOnSuccess: false,
    linear: {
      team: "ENG",
      postComments: true,
      mentionTrigger: true,
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
  const cmd: CmdRunner = {
    run: async (cmdArr) => {
      // `gh pr list` discovery for the issue — pretend no PR exists, so the
      // PR-based scan paths are skipped and Linear-comments is the sole source.
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };
  const spawnWorker = (workerCmd: string[]): { exited: Promise<number>; kill: () => void } => {
    void workerCmd;
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
  await coord.pollOnce();
  await new Promise((r) => setTimeout(r, 20));

  return { reactionCalls, pickupCommentBodies };
}

describe("fetchMentions wire layer — read-confirmed reactions", () => {
  let originalFetch: typeof fetch;
  let tempDir: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    tempDir = mkdtempSync(join(tmpdir(), "agent-react-"));
    await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
    await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("a new @ralphy mention on a Done Linear issue triggers a 👀 reactionCreate", async () => {
    const { reactionCalls, pickupCommentBodies } = await runMentionPoll(tempDir, {});
    expect(reactionCalls).toEqual([{ commentId: "comment-id-42", emoji: "👀" }]);
    // And the mention was still enqueued — the pickup ack comment was posted.
    expect(pickupCommentBodies.some((b) => b.includes("Linear @mention"))).toBe(true);
  });

  test("a reactionCreate failure does not block the mention enqueue", async () => {
    const { pickupCommentBodies } = await runMentionPoll(tempDir, { failOnReaction: true });
    expect(pickupCommentBodies.some((b) => b.includes("Linear @mention"))).toBe(true);
  });
});
