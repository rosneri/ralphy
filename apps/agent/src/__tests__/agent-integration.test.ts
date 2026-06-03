/**
 * Highest-level integration test for agent mode. Exercises the real
 *   parseArgs → loadRalphyConfig → buildAgentCoordinator → coord.pollOnce()
 * pipeline in one process. Only third parties and side-effects are mocked:
 *   - Linear API (globalThis.fetch)
 *   - git (GitRunner)
 *   - gh / generic command (CmdRunner)
 *   - the worker subprocess (`spawnWorker`)
 *   - shell scripts (`runScript`)
 *
 * The scaffold (file writes), worktree directory layout, indicator merging,
 * dedup, conflict scan, and prepare/spawn flow run for real.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAgentArgs as parseArgs } from "../cli";
import YAML from "yaml";
import { loadRalphyConfig } from "../agent/config";

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-int-"));
  // Make the project root look like an OpenSpec project so findProjectRoot
  // (in production) and the layout helpers behave normally.
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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

/**
 * In-memory Linear backend. Mirrors the GraphQL responses that
 * fetchOpenIssues / addIssueComment / updateIssueState / addLabelToIssue /
 * removeLabelFromIssue / fetchIssueLabels / fetchWorkflowStates expect.
 *
 * The backend is intentionally tiny: a Map of issues with mutable state +
 * label set, plus call recorders so tests can assert what happened.
 */
class FakeLinear {
  issues = new Map<string, FakeIssue>();
  comments: { issueId: string; body: string }[] = [];
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  descriptionMutations: { issueId: string; description: string }[] = [];
  /** name → id; both labels and workflow states share the namespace here for simplicity. */
  labelIds = new Map<string, string>();
  stateIds = new Map<string, string>();

  add(issue: FakeIssue): void {
    this.issues.set(issue.id, issue);
  }

  /** Match an issue against a Linear-shaped IssueFilter (only the bits the
   *  agent actually emits — `or` of state/labels, `and`, `state.name`,
   *  `labels.some`, `labels.every`, plus `team`/`assignee` ignored). */
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

  /** GraphQL handler. Returns the Response the agent expects. */
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
      // Reverse-lookup the state name from stateIds.
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
      // fetchIssueComments
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
}

interface FakeWorker {
  resolve: (code: number) => void;
}

/** Fake side-effect runners that record calls and let the test drive
 *  worker exits. */
function makeRunners(): {
  runners: AgentRunners;
  workers: Map<string, FakeWorker>;
  /** What `gh pr view --json mergeable` should report for the next call. */
  setMergeable: (changeName: string, mergeable: "MERGEABLE" | "CONFLICTING") => void;
  /** What `gh pr view --json state` should report. Defaults to "OPEN". */
  setPrState: (changeName: string, state: "OPEN" | "MERGED" | "CLOSED") => void;
  ghCalls: string[][];
  gitCalls: string[][];
} {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const prState = new Map<string, string>();
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];

  const git: GitRunner = {
    run: async (args, _cwd) => {
      gitCalls.push(args);
      // Pretend everything succeeds, and `worktree list --porcelain` says
      // no existing worktree (so createWorktree no-ops `worktree add`).
      if (args[0] === "worktree" && args[1] === "list") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        // branch doesn't exist locally
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
      // gh pr view --json state,mergeable
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "view") {
        const url = cmdArr[3] ?? "";
        // url looks like https://gh/pr/<slug-or-changeName>; map back via
        // the state/mergeable maps. Match by exact key, else by any key
        // that starts with the slug (covers identifier-only stubs).
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
      // gh pr list --search "<identifier> in:title" --state all --json url,state,...
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "list") {
        const searchIdx = cmdArr.indexOf("--search");
        const search = searchIdx >= 0 ? (cmdArr[searchIdx + 1] ?? "") : "";
        const identifier = search.split(" ")[0] ?? "";
        // changeName matches `<identifier-lowercased>-...`; for stubs we
        // can just key by identifier slug so prState/mergeable maps keep
        // working off changeName as the test code expects.
        const slug = identifier.toLowerCase();
        // Find a known changeName in prState/mergeable matching this slug.
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

  const spawnWorker = (_cmd: string[], _cwd: string) => {
    let resolve!: (code: number) => void;
    const exited = new Promise<number>((r) => {
      resolve = r;
    });
    // Key by the changeName which is _cmd[3] (since cmd is
    // [bun, cli.js, "task", "--name", changeName, ...])
    const idx = _cmd.indexOf("--name");
    const key = idx >= 0 ? _cmd[idx + 1]! : `worker-${workers.size}`;
    workers.set(key, { resolve });
    return { exited, kill: () => resolve(143) };
  };

  return {
    runners: {
      git,
      cmd,
      spawnWorker,
      runScript: async () => 0,
    },
    workers,
    setMergeable: (cn, m) => {
      mergeable.set(cn, m);
    },
    setPrState: (cn, s) => {
      prState.set(cn, s);
    },
    ghCalls,
    gitCalls,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

/**
 * Poll a predicate until it holds, or throw after `timeoutMs`. Worker spawn is
 * fire-and-forget (`coordinator.spawnNext → void launchWorker`), so the actual
 * `spawnWorker` call lands asynchronously after `pollOnce()` resolves. A fixed
 * `tick()` races that async prep under coverage instrumentation / slow CI; this
 * waits deterministically instead of guessing a delay.
 */
const waitFor = async (
  predicate: () => boolean,
  { timeoutMs = 2000, stepMs = 5 }: { timeoutMs?: number; stepMs?: number } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: predicate not satisfied before timeout");
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

/** Wait until a worker for `changeName` has been spawned. */
const waitForWorker = (workers: Map<string, FakeWorker>, changeName: string): Promise<void> =>
  waitFor(() => workers.has(changeName));

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe("agent integration — Linear-as-source-of-truth lifecycle", () => {
  test("end-to-end: poll → setInProgress → spawn → exit → setDone, then conflict scan flips to setConflicted and re-fixes", async () => {
    // ---- 1. Config + Linear stub ----
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
        const err = new Error("unexpected fetch in test") as Error & { url?: string };
        err.url = url;
        throw err;
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    // Write a real config and parse args through the real CLI parser.
    await writeWorkflow(tempDir, {
      concurrency: 1,
      useWorktree: false,
      createPrOnSuccess: false,
      linear: {
        team: "ENG",
        postComments: true,
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

    // ---- 2. Side-effect runners ----
    const { runners, workers, setMergeable } = makeRunners();
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

    // ---- 3. First poll: pickup, setInProgress, scaffold, spawn ----
    const poll1 = await coord.pollOnce();
    expect(poll1.added).toBe(1);
    await tick();

    // setInProgress was applied via the status mutation
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "In Progress",
    });

    // Scaffold happened on disk
    const changeName = "eng-1-add-dark-mode";
    expect(existsSync(join(tempDir, "openspec", "changes", changeName, "tasks.md"))).toBe(true);
    const proposal = readFileSync(
      join(tempDir, "openspec", "changes", changeName, "proposal.md"),
      "utf-8",
    );
    expect(proposal).toContain("ENG-1");
    expect(proposal).toContain("Users want dark mode");

    // Worker spawned
    await waitForWorker(workers, changeName);

    // Started comment posted (postComments=true)
    expect(linear.comments.some((c) => c.body.includes("Ralph started working"))).toBe(true);

    // ---- 4. Worker exits cleanly → setDone ----
    workers.get(changeName)!.resolve(0);
    await tick();

    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "Done",
    });
    expect(linear.comments.some((c) => c.body.includes("Ralph completed"))).toBe(true);

    // The issue's status is now "Done" in the fake; subsequent getTodo
    // polls won't pick it up.
    expect(linear.issues.get("uuid-eng-1")!.state.name).toBe("Done");

    // ---- 5. Re-poll: nothing to do ----
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);

    // ---- 6. Simulate main moving forward — PR is now CONFLICTING ----
    setMergeable(changeName, "CONFLICTING");

    const poll3 = await coord.pollOnce();
    await tick();

    // Conflict comment posted; conflict-fix worker re-spawned. No Linear
    // label cycle — gh is the single source of truth for merge state now.
    expect(linear.comments.some((c) => c.body.includes("merge conflicts"))).toBe(true);
    void poll3;

    const fixWorker = workers.get(changeName);
    expect(fixWorker).toBeDefined();

    // ---- 7. Conflict-fix worker exits cleanly → no label flips ----
    setMergeable(changeName, "MERGEABLE");
    fixWorker!.resolve(0);
    await tick();

    // No `ralph:conflicted` label was ever applied; nothing to remove.
    expect(
      linear.labelMutations.some(
        (m) => m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-1",
      ),
    ).toBe(false);

    // setDone is NOT applied a second time (already done; conflict-fix
    // path skips setDone).
    const doneCount = linear.statusMutations.filter((s) => s.statusName === "Done").length;
    expect(doneCount).toBe(1);
  });

  test("conflict scan short-circuits on merged/closed PRs and does not re-query", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");
    linear.add({
      id: "uuid-eng-9",
      identifier: "ENG-9",
      title: "Already merged",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
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
    const args = await parseArgs([]);

    const { runners, workers, setPrState, ghCalls } = makeRunners();
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

    // Drive the issue through the lifecycle into "Done" so the conflict
    // scan considers it on the next poll.
    await coord.pollOnce();
    const changeName = "eng-9-already-merged";
    await waitForWorker(workers, changeName);
    workers.get(changeName)!.resolve(0);
    await tick();
    expect(linear.issues.get("uuid-eng-9")!.state.name).toBe("Done");

    // Simulate the PR having been merged outside ralph.
    setPrState(changeName, "MERGED");

    const prViewCallsBefore = ghCalls.filter(
      (c) => c[0] === "gh" && c[1] === "pr" && c[2] === "view",
    ).length;

    await coord.pollOnce();
    await tick();

    // No setConflicted label applied and no "still UNKNOWN" spam.
    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-9",
      ),
    ).toBe(false);
    expect(logs.some((l) => l.includes("still UNKNOWN"))).toBe(false);

    const prViewCallsAfterFirst = ghCalls.filter(
      (c) => c[0] === "gh" && c[1] === "pr" && c[2] === "view",
    ).length;
    expect(prViewCallsAfterFirst).toBeGreaterThan(prViewCallsBefore);

    // Subsequent poll should skip `gh pr view` for this change (cached as
    // unavailable) so we don't keep hammering the merged PR.
    await coord.pollOnce();
    await tick();
    const prViewCallsAfterSecond = ghCalls.filter(
      (c) => c[0] === "gh" && c[1] === "pr" && c[2] === "view",
    ).length;
    expect(prViewCallsAfterSecond).toBe(prViewCallsAfterFirst);
  });

  test("worker non-zero exit applies setError; subsequent poll does not re-pick", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.labelIds.set("ralph:error", "label-err");
    linear.add({
      id: "uuid-eng-2",
      identifier: "ENG-2",
      title: "Bad task",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      void input;
      return linear.handle(body);
    }) as typeof fetch;

    await writeWorkflow(tempDir, {
      useWorktree: false,
      linear: {
        team: "ENG",
        postComments: false,
        indicators: {
          getTodo: { filter: [{ type: "status", value: "Todo" }] },
          setInProgress: { type: "status", value: "In Progress" },
          setError: { type: "label", value: "ralph:error" },
        },
      },
    });
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers } = makeRunners();
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
    await waitForWorker(workers, "eng-2-bad-task");

    workers.get("eng-2-bad-task")!.resolve(2);
    await tick();

    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:error" && m.issueId === "uuid-eng-2",
      ),
    ).toBe(true);

    // The fake's getTodo filter excludes ralph:error via the auto-built
    // exclude list. Re-poll should add nothing.
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);
  });
});
