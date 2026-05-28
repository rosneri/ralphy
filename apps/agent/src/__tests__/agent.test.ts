import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { loadRalphyConfig, ensureRalphyConfig } from "../agent/config";

function writeWorkflow(dir: string, frontmatter: unknown, body = ""): Promise<number> {
  const yaml = typeof frontmatter === "string" ? frontmatter : YAML.stringify(frontmatter);
  return Bun.write(join(dir, "WORKFLOW.md"), `---\n${yaml}---\n${body}`);
}
import { changeNameForIssue, scaffoldChangeForIssue } from "../agent/scaffold";
import {
  fetchOpenIssues,
  addIssueComment,
  addReactionToComment,
  fetchIssueComments,
  fetchIssueAttachments,
  fetchAttachmentsForIssues,
  createRalphyAttachment,
  updateAttachmentSubtitle,
  upsertRalphyAttachment,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  fetchTeamIdByKey,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  type LinearIssue,
} from "../agent/linear";

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
    project: null,
    labels: ["frontend"],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
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
    expect(cfg.linear.indicators).toEqual({});
    expect(cfg.linear.postComments).toBe(true);
  });

  test("loadRalphyConfig reads indicator map", async () => {
    await writeWorkflow(tempDir, {
      concurrency: 5,
      linear: {
        team: "ENG",
        indicators: {
          getTodo: { filter: [{ type: "status", value: "Todo" }] },
          setDone: { type: "status", value: "Done" },
          setError: [{ type: "label", value: "ralph:error" }],
        },
      },
    });
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.concurrency).toBe(5);
    expect(cfg.linear.team).toBe("ENG");
    expect(cfg.linear.indicators.getTodo).toEqual({
      filter: [{ type: "status", value: "Todo" }],
    });
    expect(cfg.linear.indicators.setDone).toEqual({ type: "status", value: "Done" });
    expect(cfg.linear.indicators.setError).toEqual([{ type: "label", value: "ralph:error" }]);
  });

  test("loadRalphyConfig rejects malformed frontmatter with pretty error", async () => {
    await Bun.write(join(tempDir, "WORKFLOW.md"), "no frontmatter here");
    await expect(loadRalphyConfig(tempDir)).rejects.toThrow("frontmatter");
  });

  test("loadRalphyConfig rejects unknown linear keys with pretty error", async () => {
    await writeWorkflow(tempDir, { linear: { statuses: ["Todo"], doneLabel: "shipped" } });
    await expect(loadRalphyConfig(tempDir)).rejects.toThrow("invalid settings");
    await expect(loadRalphyConfig(tempDir)).rejects.toThrow("ralph init");
  });

  test("loadRalphyConfig loads project / rules / boundaries blocks", async () => {
    await writeWorkflow(tempDir, {
      project: { name: "demo", language: "TypeScript" },
      rules: ["never break the build"],
      boundaries: { never_touch: ["dist/**"] },
    });
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.project.name).toBe("demo");
    expect(cfg.rules).toEqual(["never break the build"]);
    expect(cfg.boundaries.never_touch).toEqual(["dist/**"]);
  });

  test("ensureRalphyConfig creates WORKFLOW.md with defaults when missing", async () => {
    const path = await ensureRalphyConfig(tempDir);
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("WORKFLOW.md")).toBe(true);
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.concurrency).toBe(1);
    expect(cfg.linear.indicators).toEqual({});
  });

  test("ensureRalphyConfig leaves existing file untouched", async () => {
    const path = join(tempDir, "WORKFLOW.md");
    await writeWorkflow(tempDir, { concurrency: 7 });
    const before = readFileSync(path, "utf-8");
    const returned = await ensureRalphyConfig(tempDir);
    expect(returned).toBe(path);
    expect(readFileSync(path, "utf-8")).toBe(before);
    const cfg = await loadRalphyConfig(tempDir);
    expect(cfg.concurrency).toBe(7);
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

  test("changeNameForIssue strips trailing dash re-introduced by slice", () => {
    // Title whose 40-char slug slice lands on a `-` boundary — must not
    // produce a trailing dash in the change name.
    const name = changeNameForIssue(
      makeIssue({
        title: "Evolve mentor lost from grief to legacy and beyond",
        identifier: "LIT-180",
      }),
    );
    expect(name).toBe("lit-180-evolve-mentor-lost-from-grief-to-legacy");
    expect(name.endsWith("-")).toBe(false);
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
    // Initial tasks are planning-oriented; mission tasks are generated by the
    // agent after the plan is written (see RLF-15).
    expect(tasks).toContain("## Planning");
    expect(tasks).not.toContain("## Subtasks");
    expect(tasks).toContain("research the codebase");
    expect(tasks).toContain("Append an `## Implementation` section");
    expect(tasks).toContain("MUST start as `- [ ]` (unchecked)");
    expect(tasks).toContain("do not pre-check items");
    expect(tasks).not.toContain("Implement the changes described in proposal.md");
    expect(tasks).toContain("`## Why`");
    expect(tasks).toContain("`## What Changes`");
    expect(tasks).toContain("spec delta");
    expect(tasks).toContain("anything else to add");

    expect(proposal).toContain("## Why");
    expect(proposal).toContain("## What Changes");

    expect(existsSync(join(tasksDir, name, "design.md"))).toBe(true);
    expect(existsSync(join(tasksDir, name, "specs"))).toBe(true);
    expect(existsSync(join(statesDir, name))).toBe(true);
  });

  test("scaffoldChangeForIssue appends extra prompt under Additional instructions", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(
      tasksDir,
      statesDir,
      makeIssue(),
      [],
      "Always run lint before committing.",
    );
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).toContain("## Additional instructions");
    expect(proposal).toContain("Always run lint before committing.");

    const tasks = readFileSync(join(tasksDir, name, "tasks.md"), "utf-8");
    expect(tasks).toContain("anything else to add");
  });

  test("scaffoldChangeForIssue omits Additional instructions when prompt is empty", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, makeIssue(), [], "  ");
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).not.toContain("## Additional instructions");
  });

  test("scaffoldChangeForIssue includes Linear comments when provided", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, makeIssue(), [
      {
        id: "c1",
        body: "Looks good — please ensure dark mode follows system preference.",
        createdAt: "2026-05-01T10:00:00Z",
        user: { name: "Alice", email: "alice@example.com" },
      },
      {
        id: "c2",
        body: "Also add a toggle in /settings.",
        createdAt: "2026-05-02T09:00:00Z",
        user: null,
      },
    ]);
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).toContain("## Linear comments");
    expect(proposal).toContain("**Alice**");
    expect(proposal).toContain("system preference");
    expect(proposal).toContain("**unknown**");
    expect(proposal).toContain("toggle in /settings");
  });

  test("scaffoldChangeForIssue emits the Linear description exactly once", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const description = "Users want a dark mode toggle.";
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, makeIssue({ description }));
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    const occurrences = proposal.split(description).length - 1;
    expect(occurrences).toBe(1);
  });

  test("scaffoldChangeForIssue does not emit a ## Description header", async () => {
    const tasksDir = join(tempDir, "tasks");
    const statesDir = join(tempDir, "states");
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, makeIssue());
    const proposal = readFileSync(join(tasksDir, name, "proposal.md"), "utf-8");
    expect(proposal).not.toContain("## Description");
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

  test("fetchOpenIssues defaults to open-state filter when no include given", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
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
                  priority: 3,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  relations: { nodes: [] },
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

  test("fetchOpenIssues collapses include to a flat filter when only one kind is present", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), { status: 200 });
    });

    await fetchOpenIssues("k", {
      team: "ENG",
      assignee: "me",
      include: [
        { type: "status", value: "Todo" },
        { type: "status", value: "In Progress" },
      ],
    });
    expect(captured!.variables.filter).toEqual({
      team: { key: { eq: "ENG" } },
      assignee: { isMe: { eq: true } },
      state: { name: { in: ["Todo", "In Progress"] } },
    });
  });

  test("fetchOpenIssues ANDs status + label include as flat filter", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), { status: 200 });
    });

    await fetchOpenIssues("k", {
      include: [
        { type: "status", value: "Todo" },
        { type: "label", value: "ready" },
      ],
    });
    expect(captured!.variables.filter).toEqual({
      state: { name: { in: ["Todo"] } },
      labels: { some: { name: { in: ["ready"] } } },
    });
  });

  test("fetchOpenIssues exclude markers translate to nin / every constraints", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), { status: 200 });
    });

    await fetchOpenIssues("k", {
      include: [{ type: "status", value: "Todo" }],
      exclude: [
        { type: "status", value: "Cancelled" },
        { type: "label", value: "ralph:error" },
      ],
    });
    // status include + status exclude → AND
    expect(captured!.variables.filter).toMatchObject({
      and: [{ state: { name: { in: ["Todo"] } } }, { state: { name: { nin: ["Cancelled"] } } }],
      labels: { every: { name: { nin: ["ralph:error"] } } },
    });
  });

  test("fetchOpenIssues combines include label + exclude label via and: (Linear drops same-object some+every)", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), { status: 200 });
    });

    await fetchOpenIssues("k", {
      include: [
        { type: "status", value: "Todo" },
        { type: "label", value: "Ralphy" },
      ],
      exclude: [{ type: "label", value: "ralph:error" }],
    });
    const filter = captured!.variables.filter;
    expect(filter.labels).toBeUndefined();
    expect(filter.and).toEqual([
      { labels: { some: { name: { in: ["Ralphy"] } } } },
      { labels: { every: { name: { nin: ["ralph:error"] } } } },
    ]);
  });

  test("fetchOpenIssues handles assignee email vs id", async () => {
    let captured: { variables: { filter: Record<string, unknown> } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), { status: 200 });
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
  });

  test("fetchOpenIssues throws when GraphQL data is missing", async () => {
    mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fetchOpenIssues("k", {})).rejects.toThrow("Linear API returned no data");
  });

  test("addIssueComment posts a commentCreate mutation", async () => {
    let captured: { variables: { issueId: string; body: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }), {
        status: 200,
      });
    });
    await addIssueComment("k", "issue-1", "hello");
    expect(captured!.variables).toEqual({ issueId: "issue-1", body: "hello" });
  });

  test("fetchWorkflowStates returns nodes scoped by team key", async () => {
    let captured: { variables: { team: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(
        JSON.stringify({
          data: {
            workflowStates: {
              nodes: [
                { id: "s1", name: "Todo", type: "unstarted" },
                { id: "s2", name: "In Progress", type: "started" },
              ],
            },
          },
        }),
        { status: 200 },
      );
    });
    const states = await fetchWorkflowStates("k", "ENG");
    expect(captured!.variables).toEqual({ team: "ENG" });
    expect(states).toHaveLength(2);
    expect(states[1]!.name).toBe("In Progress");
  });

  test("fetchIssueComments returns comment nodes", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              issue: {
                comments: {
                  nodes: [
                    {
                      id: "c1",
                      body: "first",
                      createdAt: "2026-05-01T00:00:00Z",
                      user: { name: "Alice", email: null },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        ),
    );
    const out = await fetchIssueComments("k", "issue-1");
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toBe("first");
  });

  test("fetchIssueComments returns [] when issue is null", async () => {
    mockFetch(async () => new Response(JSON.stringify({ data: { issue: null } }), { status: 200 }));
    expect(await fetchIssueComments("k", "missing")).toEqual([]);
  });

  test("fetchIssueAttachments returns attachment nodes for the issue", async () => {
    let captured: { variables: { id: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(
        JSON.stringify({
          data: {
            issue: {
              attachments: {
                nodes: [
                  {
                    id: "a1",
                    url: "https://github.com/o/r/pull/42",
                    sourceType: "github",
                    title: "feat: thing",
                  },
                  { id: "a2", url: "https://other.example", sourceType: null, title: null },
                ],
              },
            },
          },
        }),
        { status: 200 },
      );
    });
    const out = await fetchIssueAttachments("k", "issue-1");
    expect(captured!.variables).toEqual({ id: "issue-1" });
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://github.com/o/r/pull/42");
  });

  test("fetchIssueAttachments returns [] when issue is null", async () => {
    mockFetch(async () => new Response(JSON.stringify({ data: { issue: null } }), { status: 200 }));
    expect(await fetchIssueAttachments("k", "missing")).toEqual([]);
  });

  test("fetchAttachmentsForIssues with empty input makes no HTTP call", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const result = await fetchAttachmentsForIssues("k", []);
    expect(calls).toBe(0);
    expect(result.size).toBe(0);
  });

  test("fetchAttachmentsForIssues batches into a single request and maps by id", async () => {
    const captured: { variables: { ids: string[] } }[] = [];
    mockFetch(async (req) => {
      captured.push((await req.json()) as { variables: { ids: string[] } });
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "b1",
                  attachments: {
                    nodes: [
                      {
                        id: "a1",
                        url: "https://github.com/o/r/pull/1",
                        sourceType: "github",
                        title: "x",
                      },
                    ],
                  },
                },
                { id: "b2", attachments: { nodes: [] } },
              ],
            },
          },
        }),
        { status: 200 },
      );
    });
    const out = await fetchAttachmentsForIssues("k", ["b1", "b2", "b3"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.variables).toEqual({ ids: ["b1", "b2", "b3"] });
    expect(out.get("b1")).toHaveLength(1);
    expect(out.get("b1")![0]!.url).toBe("https://github.com/o/r/pull/1");
    expect(out.get("b2")).toEqual([]);
    // Ids absent from the response are absent from the map (caller `?? []`s).
    expect(out.get("b3")).toBeUndefined();
  });

  test("fetchIssueAttachments sends server-side title filter when titleFilter is set", async () => {
    let captured: { query: string; variables: Record<string, unknown> } | null = null;
    mockFetch(async (req) => {
      captured = (await req.json()) as { query: string; variables: Record<string, unknown> };
      return new Response(
        JSON.stringify({
          data: {
            issue: {
              attachments: {
                nodes: [{ id: "a1", url: "https://x", sourceType: null, title: "Ralphy" }],
              },
            },
          },
        }),
        { status: 200 },
      );
    });
    const out = await fetchIssueAttachments("k", "issue-1", { titleFilter: "Ralphy" });
    expect(out).toHaveLength(1);
    expect(captured!.variables).toEqual({ id: "issue-1", titleFilter: "Ralphy" });
    expect(captured!.query).toContain("$titleFilter: String!");
    expect(captured!.query).toContain("filter: { title: { eq: $titleFilter } }");
  });

  test("fetchIssueAttachments omits the title filter variable when titleFilter is not set", async () => {
    let captured: { query: string; variables: Record<string, unknown> } | null = null;
    mockFetch(async (req) => {
      captured = (await req.json()) as { query: string; variables: Record<string, unknown> };
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }), {
        status: 200,
      });
    });
    await fetchIssueAttachments("k", "issue-1");
    expect(captured!.variables).toEqual({ id: "issue-1" });
    expect(captured!.query).not.toContain("titleFilter");
    expect(captured!.query).not.toContain("filter:");
  });

  test("updateIssueState posts an issueUpdate mutation with stateId", async () => {
    let captured: { variables: { id: string; stateId: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }), {
        status: 200,
      });
    });
    await updateIssueState("k", "issue-1", "state-2");
    expect(captured!.variables).toEqual({ id: "issue-1", stateId: "state-2" });
  });

  test("fetchIssueLabels returns label nodes scoped by team", async () => {
    const teamVariables: { team?: string }[] = [];
    mockFetch(async (req) => {
      const body = (await req.json()) as { query: string; variables: { team?: string } };
      const isTeamQuery = body.query.includes("$team: String!");
      if (isTeamQuery) teamVariables.push(body.variables);
      return new Response(
        JSON.stringify({
          data: {
            issueLabels: {
              nodes: isTeamQuery
                ? [
                    { id: "l1", name: "ralphy-done", parent: null },
                    { id: "l2", name: "needs-review", parent: null },
                  ]
                : [],
            },
          },
        }),
        { status: 200 },
      );
    });
    const labels = await fetchIssueLabels("k", "ENG");
    expect(teamVariables[0]).toEqual({ team: "ENG" });
    expect(labels).toHaveLength(2);
    const names = labels.map((l) => l.name).sort();
    expect(names).toEqual(["needs-review", "ralphy-done"]);
  });

  test("fetchIssueLabels joins parent name with colon for namespaced labels", async () => {
    mockFetch(async (req) => {
      const body = (await req.json()) as { query: string };
      const isTeamQuery = body.query.includes("$team: String!");
      return new Response(
        JSON.stringify({
          data: {
            issueLabels: {
              nodes: isTeamQuery
                ? [
                    { id: "l3", name: "error", parent: { name: "ralph" } },
                    { id: "l4", name: "in-progress", parent: { name: "ralph" } },
                    { id: "l5", name: "Bug", parent: null },
                  ]
                : [],
            },
          },
        }),
        { status: 200 },
      );
    });
    const labels = await fetchIssueLabels("k", "ENG");
    expect(labels).toHaveLength(3);
    const names = labels.map((l) => l.name).sort();
    expect(names).toEqual(["Bug", "ralph:error", "ralph:in-progress"]);
  });

  test("fetchIssueLabels merges workspace-scoped labels with team-scoped", async () => {
    mockFetch(async (req) => {
      const body = (await req.json()) as { query: string };
      const isTeamQuery = body.query.includes("$team: String!");
      return new Response(
        JSON.stringify({
          data: {
            issueLabels: {
              nodes: isTeamQuery
                ? [{ id: "team-1", name: "team-only", parent: null }]
                : [
                    { id: "ws-1", name: "ralph:conflict", parent: null },
                    { id: "ws-2", name: "ralph", parent: null },
                  ],
            },
          },
        }),
        { status: 200 },
      );
    });
    const labels = await fetchIssueLabels("k", "ENG");
    const byName = new Map(labels.map((l) => [l.name, l.id]));
    expect(byName.get("team-only")).toBe("team-1");
    expect(byName.get("ralph:conflict")).toBe("ws-1");
    expect(byName.get("ralph")).toBe("ws-2");
  });

  test("addLabelToIssue posts an issueAddLabel mutation", async () => {
    let captured: { variables: { id: string; labelId: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issueAddLabel: { success: true } } }), {
        status: 200,
      });
    });
    await addLabelToIssue("k", "issue-1", "label-9");
    expect(captured!.variables).toEqual({ id: "issue-1", labelId: "label-9" });
  });

  test("removeLabelFromIssue posts an issueRemoveLabel mutation", async () => {
    let captured: { variables: { id: string; labelId: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { issueRemoveLabel: { success: true } } }), {
        status: 200,
      });
    });
    await removeLabelFromIssue("k", "issue-1", "label-9");
    expect(captured!.variables).toEqual({ id: "issue-1", labelId: "label-9" });
  });

  test("fetchTeamIdByKey returns team id when found", async () => {
    let captured: { variables: { key: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { teams: { nodes: [{ id: "team-uuid-1" }] } } }), {
        status: 200,
      });
    });
    const id = await fetchTeamIdByKey("k", "ENG");
    expect(captured!.variables).toEqual({ key: "ENG" });
    expect(id).toBe("team-uuid-1");
  });

  test("fetchTeamIdByKey returns null when team not found", async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ data: { teams: { nodes: [] } } }), { status: 200 }),
    );
    const id = await fetchTeamIdByKey("k", "MISSING");
    expect(id).toBeNull();
  });

  test("createIssueLabel posts issueLabelCreate and returns new label id", async () => {
    let captured: { variables: { teamId: string; name: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(
        JSON.stringify({
          data: {
            issueLabelCreate: { success: true, issueLabel: { id: "label-new-1" } },
          },
        }),
        { status: 200 },
      );
    });
    const id = await createIssueLabel("k", "team-uuid-1", "ralph:in-progress");
    expect(captured!.variables).toEqual({ teamId: "team-uuid-1", name: "ralph:in-progress" });
    expect(id).toBe("label-new-1");
  });

  test("createIssueLabel returns null when issueLabel is null", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ data: { issueLabelCreate: { success: false, issueLabel: null } } }),
          { status: 200 },
        ),
    );
    const id = await createIssueLabel("k", "team-uuid-1", "ralph:in-progress");
    expect(id).toBeNull();
  });

  test("createRalphyAttachment posts attachmentCreate and returns new attachment id", async () => {
    let captured: {
      variables: { issueId: string; url: string; title: string; subtitle: string };
    } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(
        JSON.stringify({
          data: { attachmentCreate: { success: true, attachment: { id: "att-1" } } },
        }),
        { status: 200 },
      );
    });
    const id = await createRalphyAttachment(
      "k",
      "issue-uuid-1",
      "https://linear.app/eng/issue/ENG-42",
      "In Progress",
    );
    expect(captured!.variables).toEqual({
      issueId: "issue-uuid-1",
      url: "https://linear.app/eng/issue/ENG-42",
      title: "Ralphy",
      subtitle: "In Progress",
    });
    expect(id).toBe("att-1");
  });

  test("createRalphyAttachment throws when attachment is null", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ data: { attachmentCreate: { success: false, attachment: null } } }),
          { status: 200 },
        ),
    );
    await expect(
      createRalphyAttachment("k", "issue-uuid-1", "https://linear.app/eng/issue/ENG-42", "Done"),
    ).rejects.toThrow("attachmentCreate returned no attachment id");
  });

  test("updateAttachmentSubtitle posts attachmentUpdate with new subtitle", async () => {
    let captured: { variables: { id: string; subtitle: string } } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { attachmentUpdate: { success: true } } }), {
        status: 200,
      });
    });
    await updateAttachmentSubtitle("k", "att-1", "Done");
    expect(captured!.variables).toEqual({ id: "att-1", subtitle: "Done" });
  });

  test("upsertRalphyAttachment updates existing Ralphy attachment when found", async () => {
    const requests: string[] = [];
    mockFetch(async (req) => {
      const body = (await req.json()) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("IssueAttachments")) {
        requests.push("fetch");
        return new Response(
          JSON.stringify({
            data: {
              issue: {
                attachments: {
                  nodes: [
                    { id: "att-existing", url: "https://x", sourceType: null, title: "Ralphy" },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      requests.push("update");
      return new Response(JSON.stringify({ data: { attachmentUpdate: { success: true } } }), {
        status: 200,
      });
    });
    await upsertRalphyAttachment(
      "k",
      "issue-uuid-1",
      "https://linear.app/eng/issue/ENG-42",
      "Done",
    );
    expect(requests).toEqual(["fetch", "update"]);
  });

  test("upsertRalphyAttachment creates new attachment when none exists", async () => {
    const requests: string[] = [];
    mockFetch(async (req) => {
      const body = (await req.json()) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("IssueAttachments")) {
        requests.push("fetch");
        return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }), {
          status: 200,
        });
      }
      requests.push("create");
      return new Response(
        JSON.stringify({
          data: { attachmentCreate: { success: true, attachment: { id: "att-new" } } },
        }),
        { status: 200 },
      );
    });
    await upsertRalphyAttachment(
      "k",
      "issue-uuid-1",
      "https://linear.app/eng/issue/ENG-42",
      "In Progress",
    );
    expect(requests).toEqual(["fetch", "create"]);
  });

  test("addReactionToComment sends a reactionCreate mutation with commentId + emoji", async () => {
    let captured: {
      query: string;
      variables: { commentId: string; emoji: string };
    } | null = null;
    mockFetch(async (req) => {
      captured = await req.json();
      return new Response(JSON.stringify({ data: { reactionCreate: { success: true } } }), {
        status: 200,
      });
    });
    await addReactionToComment("k", "comment-uuid-1", "👀");
    expect(captured).not.toBeNull();
    expect(captured!.query).toContain("reactionCreate");
    expect(captured!.variables).toEqual({ commentId: "comment-uuid-1", emoji: "👀" });
  });
});
