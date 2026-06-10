/**
 * RLF-113 — S3 end-to-end flow scenarios.
 *
 * Tests coordinator routing decisions using the inline makeRunners +
 * FakeLinear pattern from agent-characterization.test.ts.
 *
 * test.failing tests encode currently-unimplemented behaviour:
 *   S3.1 — conflict-fix must take priority over review (not yet wired)
 *   S3.3 — mention must beat ci-fix (not yet wired)
 *   S3.4 — conflict must beat stuck (not yet wired)
 *   S3.5 — mid-iteration worker kill on conflict (not yet wired)
 *   S3.7 — awaiting-CI cap not wired (caps.ciFix missing)
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

mock.module("@ralphy/telemetry", () => ({
  capture: () => {},
  captureError: () => {},
  init: async () => {},
  shutdown: async () => {},
  setDefaultProperties: () => {},
}));

import { parseAgentArgs as parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner, WorktreeProvider } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-s3-"));
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

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  labels: Set<string>;
  priority: number;
  createdAt?: string;
  comments?: {
    id: string;
    body: string;
    createdAt: string;
    user: { name: string; email: string | null } | null;
  }[];
}

class FakeLinear {
  issues = new Map<string, FakeIssue>();
  comments: { issueId: string; body: string }[] = [];
  reactions: { commentId: string; emoji: string }[] = [];
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  labelIds = new Map<string, string>();
  stateIds = new Map<string, string>();

  add(issue: FakeIssue): void {
    this.issues.set(issue.id, issue);
  }

  matches(issue: FakeIssue, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true;
    if (filter.or) {
      return (filter.or as Record<string, unknown>[]).some((b) => this.matches(issue, b));
    }
    if (filter.and) {
      return (filter.and as Record<string, unknown>[]).every((b) => this.matches(issue, b));
    }
    if (filter.state) {
      const s = filter.state as {
        name?: { in?: string[]; nin?: string[] };
        type?: { in?: string[] };
      };
      if (s.name?.in && !s.name.in.includes(issue.state.name)) return false;
      if (s.name?.nin && s.name.nin.includes(issue.state.name)) return false;
      if (s.type?.in && !s.type.in.includes(issue.state.type)) return false;
    }
    if (filter.labels) {
      const l = filter.labels as {
        some?: { name?: { in?: string[] } };
        every?: { name?: { nin?: string[] } };
      };
      if (l.some?.name?.in) {
        const wanted = l.some.name.in;
        if (![...issue.labels].some((lbl) => wanted.includes(lbl))) return false;
      }
      if (l.every?.name?.nin) {
        const banned = l.every.name.nin;
        if ([...issue.labels].some((lbl) => banned.includes(lbl))) return false;
      }
    }
    return true;
  }

  handle(body: { query: string; variables: Record<string, unknown> }): Response {
    const q = body.query;
    if (q.includes("issues(filter")) {
      const filter = body.variables.filter as Record<string, unknown>;
      const matches = [...this.issues.values()].filter((i) => this.matches(i, filter));
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: matches.map((i) => ({
                id: i.id,
                identifier: i.identifier,
                title: i.title,
                description: i.description,
                url: `https://linear.app/x/${i.identifier}`,
                priority: i.priority,
                createdAt: i.createdAt ?? "2026-01-01T00:00:00.000Z",
                state: i.state,
                assignee: null,
                labels: { nodes: [...i.labels].map((name) => ({ name })) },
                relations: { nodes: [] },
                ...(i.comments ? { comments: { nodes: i.comments } } : {}),
              })),
            },
          },
        }),
        { status: 200 },
      );
    }
    if (q.includes("commentCreate")) {
      this.comments.push({
        issueId: body.variables.issueId as string,
        body: body.variables.body as string,
      });
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }));
    }
    if (q.includes("issueUpdate")) {
      const stateId = body.variables.stateId as string | undefined;
      const id = body.variables.id as string;
      const stateName = stateId
        ? [...this.stateIds.entries()].find(([, v]) => v === stateId)?.[0]
        : undefined;
      if (stateName) {
        const issue = this.issues.get(id);
        if (issue) issue.state = { name: stateName, type: "started" };
        this.statusMutations.push({ issueId: id, statusName: stateName });
      }
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }
    if (q.includes("issueAddLabel")) {
      const id = body.variables.id as string;
      const labelId = body.variables.labelId as string;
      const labelName = [...this.labelIds.entries()].find(([, v]) => v === labelId)?.[0];
      if (labelName) {
        this.issues.get(id)?.labels.add(labelName);
        this.labelMutations.push({ issueId: id, op: "add", labelName });
      }
      return new Response(JSON.stringify({ data: { issueAddLabel: { success: true } } }));
    }
    if (q.includes("issueRemoveLabel")) {
      const id = body.variables.id as string;
      const labelId = body.variables.labelId as string;
      const labelName = [...this.labelIds.entries()].find(([, v]) => v === labelId)?.[0];
      if (labelName) {
        this.issues.get(id)?.labels.delete(labelName);
        this.labelMutations.push({ issueId: id, op: "remove", labelName });
      }
      return new Response(JSON.stringify({ data: { issueRemoveLabel: { success: true } } }));
    }
    if (q.includes("issueLabels")) {
      return new Response(
        JSON.stringify({
          data: {
            issueLabels: {
              nodes: [...this.labelIds.entries()].map(([name, id]) => ({
                id,
                name: name.includes(":") ? name.split(":")[1]! : name,
                parent: name.includes(":") ? { name: name.split(":")[0]! } : null,
              })),
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
              nodes: [...this.stateIds.entries()].map(([name, id]) => ({
                id,
                name,
                type: "unstarted",
              })),
            },
          },
        }),
      );
    }
    if (q.includes("issueLabelCreate")) {
      const name = (body.variables.name as string) ?? "";
      const newId = `label-created-${name}`;
      this.labelIds.set(name, newId);
      return new Response(
        JSON.stringify({
          data: { issueLabelCreate: { success: true, issueLabel: { id: newId } } },
        }),
      );
    }
    if (q.includes("TeamId") || (q.includes("teams") && q.includes("key"))) {
      return new Response(JSON.stringify({ data: { teams: { nodes: [{ id: "team-fake-id" }] } } }));
    }
    if (q.includes("IssueAttachments") || q.includes("attachments(first")) {
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
    }
    if (q.includes("reactionCreate")) {
      this.reactions.push({
        commentId: body.variables.commentId as string,
        emoji: body.variables.emoji as string,
      });
      return new Response(JSON.stringify({ data: { reactionCreate: { success: true } } }));
    }
    if (q.includes("issue(id")) {
      const id = body.variables.id as string;
      const issue = this.issues.get(id);
      const nodes = issue?.comments ?? [];
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes } } } }));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
}

interface FakeWorker {
  resolve: (code: number) => void;
  cmd: string[];
}

interface MakeRunnersResult {
  runners: AgentRunners;
  workers: Map<string, FakeWorker>;
  setMergeable: (changeName: string, mergeable: "MERGEABLE" | "CONFLICTING") => void;
  setPrState: (changeName: string, state: "OPEN" | "MERGED" | "CLOSED") => void;
  setCiFailing: (changeName: string, failing: boolean) => void;
  /** Remove the fake PR for changeName so gh pr list returns empty */
  removePr: (changeName: string) => void;
  ghCalls: string[][];
  gitCalls: string[][];
  spawnCalls: string[][];
}

function makeRunners(): MakeRunnersResult {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const prState = new Map<string, string>();
  const ciFailing = new Set<string>();
  const noPr = new Set<string>();
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const spawnCalls: string[][] = [];

  const git: GitRunner = {
    run: async (args, _cwd) => {
      gitCalls.push(args);
      if (args[0] === "worktree" && args[1] === "list") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        const err = new Error("not found") as Error & { code?: number };
        err.code = 1;
        throw err;
      }
      return { stdout: "", stderr: "" };
    },
  };

  const cmd: CmdRunner = {
    run: async (cmdArr, _cwd) => {
      ghCalls.push(cmdArr);
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "view") {
        const url = cmdArr[3] ?? "";
        const tail = url.split("/").pop() ?? "";
        const findKey = (m: Map<string, string>): string | undefined => {
          if (m.has(tail)) return tail;
          for (const k of m.keys()) if (k.startsWith(tail)) return k;
          return undefined;
        };
        const sk = findKey(prState);
        const mk = findKey(mergeable);
        const payload = {
          state: (sk && prState.get(sk)) || "OPEN",
          mergeable: (mk && mergeable.get(mk)) || "MERGEABLE",
        };
        return { stdout: JSON.stringify(payload), stderr: "" };
      }
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "checks") {
        const url = cmdArr[3] ?? "";
        const tail = url.split("/").pop() ?? "";
        const findKey = (s: Set<string>): string | undefined => {
          if (s.has(tail)) return tail;
          for (const k of s) if (k.startsWith(tail)) return k;
          return undefined;
        };
        const hit = findKey(ciFailing);
        if (hit) {
          return {
            stdout: JSON.stringify([
              {
                name: "lint",
                bucket: "fail",
                link: "https://gh/owner/repo/actions/runs/12345/job/9876",
                workflow: "ci",
                event: "push",
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      }
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "list") {
        const searchIdx = cmdArr.indexOf("--search");
        const search = searchIdx >= 0 ? (cmdArr[searchIdx + 1] ?? "") : "";
        const identifier = search.split(" ")[0] ?? "";
        const slug = identifier.toLowerCase();
        let cn = "";
        for (const k of [...prState.keys(), ...mergeable.keys()]) {
          if (k.startsWith(slug)) {
            cn = k;
            break;
          }
        }
        if (!cn) cn = slug;
        // If explicitly removed, return empty
        if (noPr.has(cn)) return { stdout: JSON.stringify([]), stderr: "" };
        return {
          stdout: JSON.stringify([
            {
              url: `https://gh/pr/${cn}`,
              state: "OPEN",
              headRefName: `ralph/${cn}`,
              title: `${identifier}: stub`,
              updatedAt: "2026-05-01T00:00:00Z",
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  };

  const spawnWorker = (cmdArr: string[], _cwd: string) => {
    spawnCalls.push(cmdArr);
    let resolve!: (code: number) => void;
    const exited = new Promise<number>((r) => {
      resolve = r;
    });
    const idx = cmdArr.indexOf("--name");
    const key = idx >= 0 ? cmdArr[idx + 1]! : `worker-${workers.size}`;
    workers.set(key, { resolve, cmd: cmdArr });
    return { exited, kill: () => resolve(143) };
  };

  return {
    runners: { git, cmd, spawnWorker, runScript: async () => 0 },
    workers,
    setMergeable: (cn, m) => {
      mergeable.set(cn, m);
    },
    setPrState: (cn, s) => {
      prState.set(cn, s);
    },
    setCiFailing: (cn, failing) => {
      if (failing) ciFailing.add(cn);
      else ciFailing.delete(cn);
    },
    removePr: (cn) => {
      noPr.add(cn);
    },
    ghCalls,
    gitCalls,
    spawnCalls,
  };
}

function setupFetch(linear: FakeLinear): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("linear.app")) throw new Error("unexpected fetch in test");
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    return linear.handle(body);
  }) as typeof fetch;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

const baseWorkflow = {
  concurrency: 1,
  useWorktree: false,
  createPrOnSuccess: false,
  // Conflict recovery defaults off (RLF-97); these flows exercise it, so opt in.
  prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
  linear: {
    team: "ENG",
    postComments: true,
    updateEveryIterations: 0,
    indicators: {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
      setError: { type: "label", value: "ralph:error" },
    },
  },
};

// ─── S3 tests ────────────────────────────────────────────────────────────────

describe("S3 — coordinator flow routing", () => {
  // S3.2: confirmation gate + new-ticket coexistence (GREEN)
  // The confirmation feature claims the awaiting ticket (gate fires) while
  // the fresh-mode path picks up the new Todo ticket in the same poll.
  test("S3.2 — confirmation gate + new-ticket (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");
    linear.labelIds.set("ralph:approved", "label-approved");

    // Issue 1: In Progress, awaiting confirmation
    const issue1: FakeIssue = {
      id: "uuid-s32-1",
      identifier: "ENG-321",
      title: "Add sidebar",
      description: "Users want a sidebar",
      state: { name: "In Progress", type: "started" },
      labels: new Set(),
      priority: 3,
    };
    // Issue 2: Todo — new ticket
    const issue2: FakeIssue = {
      id: "uuid-s32-2",
      identifier: "ENG-322",
      title: "Add footer",
      description: "Users want a footer",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue1);
    linear.add(issue2);
    setupFetch(linear);

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          timeoutHours: 48,
          maxConfirmationRounds: 3,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls } = makeRunners();

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

    const changeName1 = "eng-321-add-sidebar";
    const changeName2 = "eng-322-add-footer";
    const changeDir1 = join(tempDir, "openspec", "changes", changeName1);

    // Poll 1: fresh-mode spawn for issue1 (plan phase), fresh for issue2 not yet (concurrency=1)
    await coord.pollOnce();
    // Deflake: pickup/spawn side effects land asynchronously after pollOnce —
    // wait for the coordinator to settle (the S10 pattern) before moving on.
    await coord.whenSettled();
    await tick();
    // After poll 1, issue1 is being planned (fresh spawn) and issue2 hasn't been picked up yet (concurrency=1)

    // Fill issue1's design.md so the next poll detects it as awaiting-confirmation
    await Bun.write(
      join(changeDir1, "design.md"),
      `# Design\n\n## Approach\n\nA sidebar component.\n`,
    );
    await Bun.write(
      join(changeDir1, "tasks.md"),
      `# Tasks\n\n## Implementation\n\n- [ ] Implement sidebar\n`,
    );

    // Poll 2: issue1 moves to awaiting-confirmation (gate fires), issue2 picked up
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();

    // Gate fires for issue1: "Ralphy plan ready" comment posted
    expect(linear.comments.some((c) => c.body.includes("type=plan-ready"))).toBe(true);

    // Issue2 must also be picked up (new-ticket spawn)
    const spawn2 = spawnCalls.find((c) => c.includes(changeName2));
    expect(spawn2).toBeDefined();
    expect(workers.has(changeName2)).toBe(true);
  });

  // S3.3: reviewer mention beats CI-failing (test.failing)
  // ci-fix is queued first (via maybePromoteFinishedConflicted), then the
  // mentions loop sees the issue is already in queue and skips it. Fix:
  // mention/revise must take priority over ci-fix in routing.
  test.failing("S3.3 — mention beats ci-failing (test.failing)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s33-1",
      identifier: "ENG-33",
      title: "Add header",
      description: null,
      state: { name: "In Progress", type: "started" },
      labels: new Set(),
      priority: 3,
      comments: [
        {
          id: "mention-1",
          body: "@ralph please fix the linting errors",
          createdAt: "2026-05-01T01:00:00.000Z",
          user: { name: "reviewer", email: null },
        },
      ],
    };
    linear.add(issue);
    setupFetch(linear);

    const mentionWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        mentionHandle: "ralph",
        mentionTrigger: true,
        indicators: {
          ...baseWorkflow.linear.indicators,
        },
      },
    };
    await writeWorkflow(tempDir, mentionWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setCiFailing } = makeRunners();
    const changeName = "eng-33-add-header";
    setCiFailing(changeName, true);
    // Pre-seed a PR so the coordinator can find it for the CI check
    // (setMergeable is not called → default MERGEABLE, but CI is failing)

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
    await coord.whenSettled();
    await tick();

    // Stage-2-correct: mention wins → worker spawned with review/mention trigger.
    // The mention comment body should appear in the spawn cmd indirectly.
    // Assert ci-fix did NOT get a spawn on this poll and mention-mode worker did.
    expect(workers.has(changeName)).toBe(true);
    // The spawn should NOT be a ci-fix spawn. In mention mode the coordinator
    // posts "picked up new review comments" before spawning.
    expect(linear.comments.some((c) => c.body.includes("review comments"))).toBe(true);
    // Only one spawn issued (no double-spawn).
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBe(1);
  });

  // S3.4: conflict beats stuck (GREEN)
  // When a ticket is stuck (confirmation cap exhausted) and its PR goes
  // CONFLICTING, the conflict-fix flow takes priority over the stuck flow.
  // Verified: confirmation feature does not claim Done issues, so conflict-fix
  // is detected via scanPrMergeStates.
  test("S3.4 — conflict beats stuck (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:stuck", "label-stuck");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s34-1",
      identifier: "ENG-34",
      title: "Add tooltip",
      description: null,
      state: { name: "In Progress", type: "started" },
      labels: new Set(["ralph:stuck"]),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          timeoutHours: 48,
          maxConfirmationRounds: 1,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setMergeable } = makeRunners();
    const changeName = "eng-34-add-tooltip";

    // Pre-seed the state file with stuckPostedAt so confirmation considers it stuck
    const stateDir = join(tempDir, ".ralph", "tasks", changeName);
    await mkdir(stateDir, { recursive: true });
    await Bun.write(
      join(stateDir, ".ralph-state.json"),
      JSON.stringify({
        confirmation: {
          rounds: 1,
          askedAt: "2026-01-01T00:00:00.000Z",
          stuckPostedAt: "2026-01-01T01:00:00.000Z",
        },
      }),
    );

    // Also pre-seed the design.md and tasks.md so confirmation sees planningComplete
    const changeDir = join(tempDir, "openspec", "changes", changeName);
    await mkdir(changeDir, { recursive: true });
    await Bun.write(
      join(changeDir, "design.md"),
      `# Design\n\n## Approach\n\nA tooltip component.\n`,
    );
    await Bun.write(
      join(changeDir, "tasks.md"),
      `# Tasks\n\n## Implementation\n\n- [ ] Implement tooltip\n`,
    );

    setMergeable(changeName, "CONFLICTING");

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
    await coord.whenSettled();
    await tick();

    // Stage-2-correct: conflict-fix spawns, not the stuck flow.
    // A conflict-fix worker is spawned for the change.
    expect(workers.has(changeName)).toBe(true);
    expect(spawnCalls.some((c) => c.includes(changeName))).toBe(true);
    // No duplicate stuck comment is posted (stuckPostedAt already set).
    const stuckComments = linear.comments.filter((c) => c.body.includes("confirmation gate stuck"));
    expect(stuckComments.length).toBe(0);
  });

  // S3.5: mid-iteration preemption (test.failing)
  // When a PR flips to CONFLICTING while a worker is running, the
  // coordinator must kill the active worker. Currently scanPrMergeStates
  // skips issues that have an active worker.
  test.failing(
    "S3.5 — implement worker killed when PR goes CONFLICTING (test.failing)",
    async () => {
      const linear = new FakeLinear();
      linear.stateIds.set("Todo", "state-todo");
      linear.stateIds.set("In Progress", "state-inprogress");
      linear.stateIds.set("Done", "state-done");
      linear.labelIds.set("ralph:error", "label-err");

      const issue: FakeIssue = {
        id: "uuid-s35-1",
        identifier: "ENG-35",
        title: "Add modal",
        description: null,
        state: { name: "Todo", type: "unstarted" },
        labels: new Set(),
        priority: 3,
      };
      linear.add(issue);
      setupFetch(linear);

      await writeWorkflow(tempDir, baseWorkflow);
      const cfg = await loadRalphyConfig(tempDir);
      const args = await parseArgs([]);

      const { runners, workers, spawnCalls, setMergeable } = makeRunners();
      const changeName = "eng-35-add-modal";

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

      // Poll 1: fresh spawn
      await coord.pollOnce();
      await coord.whenSettled();
      await tick();
      expect(workers.has(changeName)).toBe(true);

      // While worker is running, PR flips to CONFLICTING
      setMergeable(changeName, "CONFLICTING");

      // Poll 2: coordinator must detect conflict and kill active worker
      await coord.pollOnce();
      await coord.whenSettled();
      await tick();

      // Stage-2-correct: the worker's exited promise resolved with 143 (SIGKILL)
      // and a new conflict-fix spawn is issued.
      const spawns = spawnCalls.filter((c) => c.includes(changeName));
      // At least two spawns: the original fresh and the conflict-fix
      expect(spawns.length).toBeGreaterThanOrEqual(2);
    },
  );

  // S3.7: awaiting-CI pass clears the parked ticket (GREEN)
  // Verified: the coordinator's scanPrMergeStates picks up the parked ticket
  // when CI passes (the awaiting-ci feature path is one route; the PR scan is
  // another). The spawn fires via the resume queue once CI clears.
  test("S3.7 — awaiting-CI pass clears parked ticket (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s37-1",
      identifier: "ENG-37",
      title: "Add animation",
      description: null,
      state: { name: "In Progress", type: "started" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, spawnCalls } = makeRunners();
    const changeName = "eng-37-add-animation";

    // Pre-seed the state file with awaitingCi: "watching"
    const stateDir = join(tempDir, ".ralph", "tasks", changeName);
    await mkdir(stateDir, { recursive: true });
    await Bun.write(
      join(stateDir, ".ralph-state.json"),
      JSON.stringify({ awaitingCi: "watching" }),
    );

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

    // CI is now passing (mergeable, no failing checks)
    // Poll: awaiting-ci "pass" should fire and the ticket should resume
    const poll = await coord.pollOnce();
    await coord.whenSettled();
    await tick();

    // Stage-2-correct: the awaiting-ci bucket clears, ticket resumes or Done.
    // Since CI passed, the ticket should move out of awaiting-ci and spawn a worker.
    expect(spawnCalls.some((c) => c.includes(changeName))).toBe(true);
    expect(poll.buckets.awaiting ?? 0).toBe(0);
  });

  // S3.9: consecutive flows — new-ticket → implement → conflict-fix (GREEN)
  // Each flow transition preserves state fields written by the previous flow.
  test("S3.9 — consecutive flows: no orphan state (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s39-1",
      identifier: "ENG-39",
      title: "Add tabs",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setMergeable } = makeRunners();
    const changeName = "eng-39-add-tabs";

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

    // Phase 1: new-ticket → implement → done
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(workers.has(changeName)).toBe(true);
    workers.get(changeName)!.resolve(0);
    await tick();
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-s39-1",
      statusName: "Done",
    });
    expect(linear.issues.get("uuid-s39-1")!.state.name).toBe("Done");

    // Phase 2: conflict-fix (Done ticket, PR goes CONFLICTING)
    setMergeable(changeName, "CONFLICTING");
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    // Conflict-fix worker spawned
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBeGreaterThanOrEqual(2);
    expect(workers.has(changeName)).toBe(true);
    // Conflict comment posted
    expect(linear.comments.some((c) => c.body.includes("merge conflicts"))).toBe(true);
    workers.get(changeName)!.resolve(0);
    await tick();

    // State preservation: setDone was applied exactly once (from implement phase),
    // not re-applied during conflict-fix.
    const doneCount = linear.statusMutations.filter((s) => s.statusName === "Done").length;
    expect(doneCount).toBe(1);
  });

  // S3.12: deferred-done advance via the pure-discovery recovery route (RLF-97).
  // An in-progress ticket (never marked done) with a CONFLICTING PR is
  // conflict-fixed; on success its flow actor parks in `awaiting-ci`, and the
  // next poll — once the PR is mergeable — advances the ticket to done. This is
  // the watcher's advance-to-done machinery exercised end-to-end through the
  // real wire, no PR creation needed.
  test("S3.12 — in-progress conflicting PR → conflict-fix → mergeable → watcher advances to done (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s312-1",
      identifier: "ENG-90",
      title: "Add advance flow",
      description: null,
      state: { name: "In Progress", type: "started" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow); // baseWorkflow has fixConflicts:true
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setMergeable } = makeRunners();
    const changeName = "eng-90-add-advance-flow";
    setMergeable(changeName, "CONFLICTING");

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

    // Poll 1: conflicting PR → conflict-fix worker spawns. Ticket NOT done.
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(spawnCalls.some((c) => c.includes(changeName))).toBe(true);
    expect(linear.statusMutations.some((m) => m.statusName === "Done")).toBe(false);

    // Conflict-fix succeeds → actor parks in awaiting-ci. Still not done.
    workers.get(changeName)!.resolve(0);
    await tick();
    expect(linear.statusMutations.some((m) => m.statusName === "Done")).toBe(false);
    expect(linear.issues.get("uuid-s312-1")!.state.name).toBe("In Progress");

    // Poll 2: PR is mergeable → the watcher advances the in-review ticket to done.
    setMergeable(changeName, "MERGEABLE");
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-s312-1",
      statusName: "Done",
    });
    expect(linear.issues.get("uuid-s312-1")!.state.name).toBe("Done");
    // Advanced exactly once.
    expect(linear.statusMutations.filter((m) => m.statusName === "Done").length).toBe(1);
  });

  // S3.13: fixConflicts:false leaves a conflicting PR for a human (RLF-97).
  // A done-candidate with a CONFLICTING PR is NOT recovered when fixConflicts is
  // off — no conflict-fix worker, no conflict comment.
  test("S3.13 — fixConflicts:false → conflicting PR is left alone, no conflict-fix (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s313-1",
      identifier: "ENG-91",
      title: "Left alone",
      description: null,
      state: { name: "Done", type: "completed" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    // Override baseWorkflow: turn conflict recovery OFF.
    await writeWorkflow(tempDir, {
      ...baseWorkflow,
      prRecovery: { enabled: true, fixCi: true, fixConflicts: false },
    });
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, spawnCalls, setMergeable } = makeRunners();
    const changeName = "eng-91-left-alone";
    setMergeable(changeName, "CONFLICTING");

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
    await coord.whenSettled();
    await tick();
    // No conflict-fix worker spawned, no conflict comment posted.
    expect(spawnCalls.some((c) => c.includes(changeName))).toBe(false);
    expect(linear.comments.some((c) => c.body.includes("merge conflicts"))).toBe(false);
  });

  // S3.14: the createPr deferred-done seam, end-to-end through the REAL wire
  // (RLF-97). A PR-producing run (createPrOnSuccess) opens the PR in the
  // post-task phase, registers it (populating prByChange), and the coordinator
  // DEFERS setDone to the watcher — which advances the ticket once the PR is
  // mergeable. Worktree provisioning is injected so the run never touches
  // ~/.ralph; everything else (prepare → scaffold → runPrPhase → notifyExited →
  // scanPrMergeStates → advancePrToDone) runs for real. This pins the
  // composition/timing — the PR phase populating prByChange BEFORE notifyExited
  // reads it — that the injection-level unit tests can't.
  test("S3.14 — createPr run opens PR, defers done, then watcher advances on mergeable (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s314-1",
      identifier: "ENG-92",
      title: "Add deferred wire",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    // createPrOnSuccess + useWorktree ⇒ createsPrs=true ⇒ the worker opens a PR
    // and the coordinator defers setDone.
    await writeWorkflow(tempDir, { ...baseWorkflow, createPrOnSuccess: true, useWorktree: true });
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const prUrl = "https://github.com/owner/repo/pull/920";
    let prMergeable = false; // flipped before poll 2

    const workers = new Map<string, { resolve: (code: number) => void }>();
    const spawnWorker = (cmdArr: string[]) => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      const idx = cmdArr.indexOf("--name");
      const key = idx >= 0 ? cmdArr[idx + 1]! : `worker-${workers.size}`;
      workers.set(key, { resolve });
      return { exited, kill: () => resolve(143) };
    };

    // The PR phase issues BOTH git and gh through the CmdRunner (as
    // ["git", …] / ["gh", …]). Make runPrPhase succeed: commits ahead + a
    // non-meta diff (so the PR isn't blocked as only-meta), clean status, ok
    // push; no existing PR → create returns the URL; view reports mergeable only
    // after we flip the flag; checks empty (treated as green).
    const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    const cmd: CmdRunner = {
      run: async (c) => {
        if (c[0] === "git") {
          const s = c.join(" ");
          if (s.includes("log")) return { stdout: "abc real implementation work", stderr: "" };
          if (s.includes("diff") && s.includes("--name-only")) {
            return { stdout: "src/feature.ts\n", stderr: "" };
          }
          return { stdout: "", stderr: "" }; // status (clean), push, etc.
        }
        if (c[1] === "pr" && c[2] === "list") return { stdout: "", stderr: "" };
        if (c[1] === "pr" && c[2] === "create") return { stdout: prUrl, stderr: "" };
        if (c[1] === "pr" && c[2] === "view") {
          return {
            stdout: JSON.stringify({
              state: "OPEN",
              mergeable: prMergeable ? "MERGEABLE" : "UNKNOWN",
              mergeStateStatus: prMergeable ? "CLEAN" : "UNKNOWN",
              isDraft: false,
            }),
            stderr: "",
          };
        }
        if (c[1] === "pr" && c[2] === "checks") return { stdout: "[]", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    };
    // Injected worktree provider: a temp-dir cwd, no ~/.ralph, no real git worktree.
    const worktree: WorktreeProvider = {
      create: async (input) => {
        const cwd = join(tempDir, "wt", input.changeName);
        await mkdir(cwd, { recursive: true });
        return { cwd, branch: `ralph/${input.changeName}`, created: true };
      },
      seedMcpConfig: async () => {},
    };

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
      runners: { git, cmd, spawnWorker, runScript: async () => 0, worktree },
    });
    await coord.init();

    // Poll 1: fresh pickup → worker spawns (ticket moves to In Progress).
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    const changeName = [...workers.keys()][0];
    expect(changeName).toBeDefined();

    // Worker exits clean → the PR phase opens + registers the PR, and the
    // coordinator DEFERS setDone (the run opens PRs). Ticket is NOT Done.
    workers.get(changeName!)!.resolve(0);
    await tick();
    expect(linear.statusMutations.some((m) => m.statusName === "Done")).toBe(false);

    // Poll 2: the PR is now mergeable → the watcher advances the ticket to done.
    prMergeable = true;
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-s314-1",
      statusName: "Done",
    });
    expect(linear.statusMutations.filter((m) => m.statusName === "Done").length).toBe(1);
  });

  // S3.10: idle poll (GREEN)
  // When no issue matches any active bucket, added=0 and no worker spawns.
  test("S3.10 — idle poll: added=0, no spawn (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Done", "state-done");
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, spawnCalls } = makeRunners();

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

    const poll = await coord.pollOnce();
    await coord.whenSettled();

    expect(poll.added).toBe(0);
    expect(spawnCalls.length).toBe(0);
  });

  // S3.11: stuck comment posted once, not repeated (GREEN)
  // stuckPostedAt watermark prevents re-posting on subsequent polls.
  test("S3.11 — stuck comment idempotent (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:stuck", "label-stuck");
    linear.labelIds.set("ralph:approved", "label-approved");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s311-1",
      identifier: "ENG-311",
      title: "Add breadcrumbs",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          timeoutHours: 48,
          maxConfirmationRounds: 1,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers } = makeRunners();
    const changeName = "eng-311-add-breadcrumbs";

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

    const changeDir = join(tempDir, "openspec", "changes", changeName);

    const fillDesign = async (): Promise<void> => {
      await Bun.write(join(changeDir, "design.md"), `# Design\n\n## Approach\n\nBreadcrumb nav.\n`);
      await Bun.write(
        join(changeDir, "tasks.md"),
        `# Tasks\n\n## Implementation\n\n- [ ] Implement breadcrumbs\n`,
      );
    };

    // Poll 1: fresh spawn
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(workers.has(changeName)).toBe(true);
    await fillDesign();

    // Poll 2: gate fires (rounds=0), plan-ready posted
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(linear.comments.some((c) => c.body.includes("type=plan-ready"))).toBe(true);

    // Inject a revise comment to bump rounds to 1 (== cap)
    const issueObj = linear.issues.get("uuid-s311-1")!;
    if (!issueObj.comments) issueObj.comments = [];
    issueObj.comments.push({
      id: "revise-s311",
      body: "@ralphy revise: reconsider",
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      user: { name: "reviewer", email: null },
    });

    await fillDesign();

    // Poll 3: revise consumed → rounds=1 (== cap)
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();

    await fillDesign();

    // Poll 4: cap exhausted → stuck comment posted, stuckPostedAt set
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    expect(linear.comments.some((c) => c.body.includes("confirmation gate stuck"))).toBe(true);

    const stuckCommentsBefore = linear.comments.filter((c) =>
      c.body.includes("confirmation gate stuck"),
    ).length;
    expect(stuckCommentsBefore).toBe(1);

    // Poll 5: stuckPostedAt is set → no re-post
    await coord.pollOnce();
    await coord.whenSettled();
    await tick();
    const stuckCommentsAfter = linear.comments.filter((c) =>
      c.body.includes("confirmation gate stuck"),
    ).length;
    expect(stuckCommentsAfter).toBe(1);
  });
});
