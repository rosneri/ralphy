import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRalphyConfig, ensureRalphyConfig } from "../agent/config";
import { readAgentState, writeAgentState } from "../agent/state";
import { changeNameForIssue, scaffoldChangeForIssue } from "../agent/scaffold";
import { fetchOpenIssues, type LinearIssue } from "../agent/linear";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-uuid-1",
    identifier: "ENG-42",
    title: "Add dark mode to settings panel",
    description: "Users want a dark mode toggle.",
    url: "https://linear.app/eng/issue/ENG-42/add-dark-mode",
    state: { name: "Todo", type: "unstarted" },
    assignee: { id: "u1", email: "dev@example.com", name: "Dev" },
    labels: ["frontend"],
    ...overrides,
  };
}

describe("agent/config", () => {
  test("loadRalphyConfig returns defaults when file missing", async () => {
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.concurrency).toBe(1);
    expect(cfg.pollIntervalSeconds).toBe(60);
    expect(cfg.engine).toBe("claude");
    expect(cfg.model).toBe("opus");
    expect(cfg.linear.statuses).toEqual([]);
  });

  test("loadRalphyConfig reads existing file", async () => {
    await Bun.write(
      join(tempDir, "ralphy.config.json"),
      JSON.stringify({
        concurrency: 5,
        pollIntervalSeconds: 30,
        engine: "codex",
        linear: { team: "ENG", statuses: ["Todo"] },
      }),
    );
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.concurrency).toBe(5);
    expect(cfg.pollIntervalSeconds).toBe(30);
    expect(cfg.engine).toBe("codex");
    expect(cfg.linear.team).toBe("ENG");
    expect(cfg.linear.statuses).toEqual(["Todo"]);
  });

  test("ensureRalphyConfig creates file with defaults when missing", async () => {
    const path = await ensureRalphyConfig(tempDir);
    expect(existsSync(path)).toBe(true);
    const json = JSON.parse(readFileSync(path, "utf-8"));
    expect(json.concurrency).toBe(1);
  });

  test("ensureRalphyConfig leaves existing file untouched", async () => {
    const path = join(tempDir, "ralphy.config.json");
    await Bun.write(path, JSON.stringify({ concurrency: 7 }));
    const returned = await ensureRalphyConfig(tempDir);
    expect(returned).toBe(path);
    const json = JSON.parse(readFileSync(path, "utf-8"));
    expect(json.concurrency).toBe(7);
  });
});

describe("agent/state", () => {
  test("readAgentState returns defaults when missing", async () => {
    const s = await readAgentState(tempDir);
    expect(s.processedIssueIds).toEqual([]);
    expect(s.lastPollAt).toBeNull();
  });

  test("write then read roundtrip", async () => {
    await writeAgentState(tempDir, {
      processedIssueIds: ["a", "b"],
      lastPollAt: "2026-05-04T00:00:00Z",
    });
    const s = await readAgentState(tempDir);
    expect(s.processedIssueIds).toEqual(["a", "b"]);
    expect(s.lastPollAt).toBe("2026-05-04T00:00:00Z");
  });
});

describe("agent/scaffold", () => {
  test("changeNameForIssue produces id-prefixed slug", () => {
    expect(changeNameForIssue(makeIssue())).toBe("eng-42-add-dark-mode-to-settings-panel");
  });

  test("changeNameForIssue truncates long titles", () => {
    const name = changeNameForIssue(makeIssue({ title: "a".repeat(100), identifier: "ENG-1" }));
    expect(name.startsWith("eng-1-")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  test("changeNameForIssue falls back to identifier when title is empty", () => {
    expect(changeNameForIssue(makeIssue({ title: "!!!", identifier: "ENG-9" }))).toBe("eng-9");
  });

  test("scaffoldChangeForIssue creates proposal/tasks/design files", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, makeIssue());
    expect(name).toBe("eng-42-add-dark-mode-to-settings-panel");

    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).toContain("ENG-42");
    expect(proposal).toContain("Users want a dark mode toggle");
    expect(proposal).toContain("Status: Todo");
    expect(proposal).toContain("Assignee: Dev");
    expect(proposal).toContain("Labels: frontend");

    const tasks = readFileSync(join(tasksDir, name, "tasks.md"), "utf-8");
    expect(tasks).toContain("- [ ]");
    expect(tasks).toContain("https://linear.app/eng/issue/ENG-42");

    expect(existsSync(join(tasksDir, name, "design.md"))).toBe(true);
    expect(existsSync(join(tasksDir, name, "specs"))).toBe(true);
    expect(existsSync(join(statesDir, name))).toBe(true);
  });

  test("scaffoldChangeForIssue handles missing description and assignee", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(
      tasksDir,
      statesDir,
      makeIssue({ description: null, assignee: null, labels: [] }),
    );
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).toContain("_No description provided in Linear._");
    expect(proposal).not.toContain("Assignee:");
    expect(proposal).not.toContain("Labels:");
  });
});

describe("agent/linear", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(impl: (req: Request) => Promise<Response>) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const req = new Request(url, init);
      return impl(req);
    }) as typeof fetch;
  }

  test("fetchOpenIssues posts GraphQL with default open-state filter", async () => {
    let captured: { query: string; variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "u1",
                  identifier: "ENG-1",
                  title: "T",
                  description: "D",
                  url: "https://x",
                  state: { name: "Todo", type: "unstarted" },
                  assignee: null,
                  labels: { nodes: [{ name: "bug" }] },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    });

    const issues = await fetchOpenIssues("api-key", {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.identifier).toBe("ENG-1");
    expect(issues[0]!.labels).toEqual(["bug"]);
    expect(captured!.variables.filter).toEqual({
      state: { type: { in: ["unstarted", "started", "backlog"] } },
    });
  });

  test("fetchOpenIssues builds team/assignee/status/label filters", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), {
        status: 200,
      });
    });

    await fetchOpenIssues("k", {
      team: "ENG",
      assignee: "me",
      statuses: ["Todo", "In Progress"],
      label: "p1",
    });
    expect(captured!.variables.filter).toEqual({
      team: { key: { eq: "ENG" } },
      assignee: { isMe: { eq: true } },
      state: { name: { in: ["Todo", "In Progress"] } },
      labels: { some: { name: { eq: "p1" } } },
    });
  });

  test("fetchOpenIssues handles assignee email vs id", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), {
        status: 200,
      });
    });

    await fetchOpenIssues("k", { assignee: "dev@example.com" });
    expect(captured!.variables.filter.assignee).toEqual({ email: { eq: "dev@example.com" } });

    await fetchOpenIssues("k", { assignee: "user-id-abc" });
    expect(captured!.variables.filter.assignee).toEqual({ id: { eq: "user-id-abc" } });
  });

  test("fetchOpenIssues throws with status/body on non-OK response", async () => {
    mockFetch(async () => new Response("boom", { status: 500 }));
    let caught: unknown;
    try {
      await fetchOpenIssues("k", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { status?: number; body?: string };
    expect(err.status).toBe(500);
    expect(err.body).toBe("boom");
    expect(err.message).toBe("Linear API request failed");
  });

  test("fetchOpenIssues throws with messages when GraphQL returns errors", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 }),
    );
    let caught: unknown;
    try {
      await fetchOpenIssues("k", {});
    } catch (e) {
      caught = e;
    }
    const err = caught as Error & { messages?: string[] };
    expect(err.messages).toEqual(["bad query"]);
    expect(err.message).toBe("Linear API returned errors");
  });

  test("fetchOpenIssues returns [] when data is missing", async () => {
    mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await fetchOpenIssues("k", {})).toEqual([]);
  });
});
