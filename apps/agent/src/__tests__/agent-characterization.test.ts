/**
 * RLF-89 Stage-0 — Characterization tests (regression net).
 *
 * Pins observable behavior of `buildAgentCoordinator` + `coord.pollOnce()`
 * across seven scenarios using the same fake-harness pattern as
 * `agent-integration.test.ts`. Three scenarios are pinned with
 * `test.failing(...)` to encode bugs that Stage 2 will flip from red to
 * green by removing the `.failing` marker.
 *
 * Bun 1.3.14 supports `test.failing`, confirmed in the loop before this
 * file was authored. No `expect(...).toThrow()` fallback is needed.
 *
 * Stage-0 scope note: today's coordinator has 4 spawn modes (fresh,
 * resume, conflict-fix, review) and a flat Todo→InProgress→Done
 * lifecycle. The conceptual names in the scenario titles ("approval",
 * "implement", "design", "ci-fix") describe Stage-2 terminology — the
 * green-test bodies assert what the code does TODAY, and the `.failing`
 * bodies assert what Stage-2 SHOULD do (encoded so flipping the marker
 * is the only edit needed).
 *
 * Scenarios (filled in across the loop, one per iteration):
 *   1. new ticket → approval → implement → done                  (green, goldens)
 *   2. new ticket → revise → design → approval → implement       (green)
 *   3. gated ticket + PR conflicted → conflict-fix wins          (test.failing)
 *   4. gated ticket + CI failing → ci-fix wins                   (test.failing)
 *   5. approval persisted + tasks reset for conflict-fix         (test.failing)
 *   6. round-cap exhaustion → stuck                              (green)
 *   7. finished + PR conflicting → conflict-fix                  (green)
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-char-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fakes (copied from agent-integration.test.ts; kept inline per design.md
// "Extracted only if the test file would otherwise exceed ~600 lines")
// ---------------------------------------------------------------------------

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
}

class FakeLinear {
  issues = new Map<string, FakeIssue>();
  comments: { issueId: string; body: string }[] = [];
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  descriptionMutations: { issueId: string; description: string }[] = [];
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
      const s = filter.state as { name?: { in?: string[]; nin?: string[] } };
      if (s.name?.in && !s.name.in.includes(issue.state.name)) return false;
      if (s.name?.nin && s.name.nin.includes(issue.state.name)) return false;
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
      const description = body.variables.description as string | undefined;
      const stateName = stateId
        ? [...this.stateIds.entries()].find(([, v]) => v === stateId)?.[0]
        : undefined;
      if (stateName) {
        const issue = this.issues.get(id);
        if (issue) issue.state = { name: stateName, type: "started" };
        this.statusMutations.push({ issueId: id, statusName: stateName });
      }
      if (description !== undefined) {
        const issue = this.issues.get(id);
        if (issue) issue.description = description;
        this.descriptionMutations.push({ issueId: id, description });
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
    if (q.includes("issue(id")) {
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
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
  ghCalls: string[][];
  gitCalls: string[][];
  spawnCalls: string[][];
}

function makeRunners(): MakeRunnersResult {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const prState = new Map<string, string>();
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
    ghCalls,
    gitCalls,
    spawnCalls,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

const baseWorkflow = {
  concurrency: 1,
  useWorktree: false,
  createPrOnSuccess: false,
  linear: {
    team: "ENG",
    postComments: true,
    updateEveryIterations: 0,
    indicators: {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getConflicted: { filter: [{ type: "label", value: "ralph:conflicted" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
      setError: { type: "label", value: "ralph:error" },
      setConflicted: { type: "label", value: "ralph:conflicted" },
      clearConflicted: { type: "label", value: "ralph:conflicted" },
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent characterization — Stage-0 regression net", () => {
  test("scenario 1: new ticket → approval → implement → done (green)", async () => {
    // Stage-0 pin: today this collapses to a single fresh-mode spawn that
    // takes the ticket Todo → InProgress (on pickup) → Done (on clean
    // worker exit). No separate approval/implement step exists yet;
    // Stage-2 will split this into a gate + implement pair. The test
    // asserts the current observable contract.
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-eng-1",
      identifier: "ENG-1",
      title: "Add dark mode",
      description: "Users want dark mode",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls } = makeRunners();
    const logs: string[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text) => logs.push(text),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });

    await coord.init();

    // Poll 1: pickup, setInProgress, scaffold, spawn
    const poll1 = await coord.pollOnce();
    expect(poll1.added).toBe(1);
    await tick();

    // State mutation: setInProgress applied on pickup
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "In Progress",
    });

    // tasks.md transition: change scaffolded on disk
    const changeName = "eng-1-add-dark-mode";
    expect(existsSync(join(tempDir, "openspec", "changes", changeName, "tasks.md"))).toBe(true);
    const proposal = readFileSync(
      join(tempDir, "openspec", "changes", changeName, "proposal.md"),
      "utf-8",
    );
    expect(proposal).toContain("ENG-1");
    expect(proposal).toContain("Users want dark mode");

    // Spawn mode contract: a single worker was spawned for this change
    // with the change name passed via `--name <changeName>`.
    expect(workers.has(changeName)).toBe(true);
    const spawnForChange = spawnCalls.find((c) => c.includes(changeName));
    expect(spawnForChange).toBeDefined();
    const nameIdx = spawnForChange!.indexOf("--name");
    expect(spawnForChange![nameIdx + 1]).toBe(changeName);

    // Started comment posted
    expect(linear.comments.some((c) => c.body.includes("Ralph started working"))).toBe(true);

    // Worker exits cleanly → setDone
    workers.get(changeName)!.resolve(0);
    await tick();

    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "Done",
    });
    expect(linear.comments.some((c) => c.body.includes("Ralph completed"))).toBe(true);
    expect(linear.issues.get("uuid-eng-1")!.state.name).toBe("Done");

    // No error label was applied along the happy path
    expect(linear.labelMutations.some((m) => m.labelName === "ralph:error")).toBe(false);

    // Re-poll: nothing to do (issue is Done, filter excludes it)
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);

    // Single fresh-mode spawn for this issue across the entire flow
    const spawnsForChange = spawnCalls.filter((c) => c.includes(changeName));
    expect(spawnsForChange.length).toBe(1);
  });
});
