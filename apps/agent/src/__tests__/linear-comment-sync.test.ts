import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  planningComplete,
  isCommentNotFoundError,
  type CommentMutations,
} from "../agent/linear-sync/comment-sync";

let tempDir: string;
let changeDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "comment-sync-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  statePath = join(tempDir, ".ralph", "tasks", "demo", ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface FakeMutations extends CommentMutations {
  createdBodies: { issueId: string; body: string }[];
  updatedBodies: { id: string; body: string }[];
  deletedIds: string[];
  failNextUpdateWithNotFound: boolean;
}

function makeMutations(initialId = 1): FakeMutations {
  let nextId = initialId;
  const m: FakeMutations = {
    createdBodies: [],
    updatedBodies: [],
    deletedIds: [],
    failNextUpdateWithNotFound: false,
    createIssueComment: async (_apiKey, issueId, body) => {
      m.createdBodies.push({ issueId, body });
      return `c-${nextId++}`;
    },
    updateIssueComment: async (_apiKey, id, body) => {
      if (m.failNextUpdateWithNotFound) {
        m.failNextUpdateWithNotFound = false;
        const err = new Error("Linear API returned errors") as Error & { messages?: string[] };
        err.messages = ["Entity not found: Comment"];
        throw err;
      }
      m.updatedBodies.push({ id, body });
    },
    deleteIssueComment: async (_apiKey, id) => {
      m.deletedIds.push(id);
    },
  };
  return m;
}

async function readState(): Promise<{ linearComments?: Record<string, unknown> }> {
  return JSON.parse(await Bun.file(statePath).text()) as {
    linearComments?: Record<string, unknown>;
  };
}

describe("planningComplete", () => {
  test("returns allChecked when all Planning items are done", () => {
    const md = "## Planning\n\n- [x] a\n- [x] b\n\n## Implementation\n\n- [ ] x\n";
    expect(planningComplete(md).allChecked).toBe(true);
  });

  test("returns false when any Planning item is unchecked", () => {
    const md = "## Planning\n\n- [x] a\n- [ ] b\n";
    expect(planningComplete(md).allChecked).toBe(false);
  });

  test("returns false when no Planning section exists", () => {
    expect(planningComplete("## Implementation\n\n- [x] z\n").allChecked).toBe(false);
  });
});

describe("isCommentNotFoundError", () => {
  test("detects 'not found' wording on messages array", () => {
    const e = new Error("err") as Error & { messages?: string[] };
    e.messages = ["Entity not found: Comment(c-1)"];
    expect(isCommentNotFoundError(e)).toBe(true);
  });
  test("detects 'could not find' on message string", () => {
    expect(isCommentNotFoundError(new Error("Could not find the requested entity"))).toBe(true);
  });
  test("returns false for unrelated errors", () => {
    expect(isCommentNotFoundError(new Error("rate limited"))).toBe(false);
  });
});

describe("postOrUpdateTasksComment", () => {
  test("first sync creates a fresh comment and persists the id", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [ ] one\n", "utf-8");
    const m = makeMutations();
    const id = await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      mutations: m,
    });
    expect(id).toBe("c-1");
    expect(m.createdBodies.length).toBe(1);
    expect(m.createdBodies[0]!.issueId).toBe("issue-1");
    expect(m.createdBodies[0]!.body).toContain("- [ ] one");
    const s = await readState();
    expect((s.linearComments as { tasksCommentId?: string }).tasksCommentId).toBe("c-1");
  });

  test("subsequent sync updates in place using the persisted id", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [ ] one\n", "utf-8");
    const m = makeMutations();
    await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      mutations: m,
    });
    // Change tasks.md, then sync again.
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [x] one\n", "utf-8");
    const id = await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 2,
      log: () => {},
      mutations: m,
    });
    expect(id).toBe("c-1");
    expect(m.createdBodies.length).toBe(1);
    expect(m.updatedBodies.length).toBe(1);
    expect(m.updatedBodies[0]!.id).toBe("c-1");
    expect(m.updatedBodies[0]!.body).toContain("- [x] one");
  });

  test("recovers when comment was deleted manually (update returns not found)", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [ ] one\n", "utf-8");
    const m = makeMutations();
    await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      mutations: m,
    });
    m.failNextUpdateWithNotFound = true;
    const id = await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 2,
      log: () => {},
      mutations: m,
    });
    expect(id).toBe("c-2");
    expect(m.createdBodies.length).toBe(2);
    const s = await readState();
    expect((s.linearComments as { tasksCommentId?: string }).tasksCommentId).toBe("c-2");
  });

  test("skips when tasks.md is missing", async () => {
    const m = makeMutations();
    const id = await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      mutations: m,
    });
    expect(id).toBeNull();
    expect(m.createdBodies.length).toBe(0);
  });
});

describe("postPlanCommentOnce", () => {
  test("posts once when planning is complete and persists id+timestamp", async () => {
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] a\n- [x] b\n\n## Implementation\n\n- [ ] x\n",
      "utf-8",
    );
    writeFileSync(
      join(changeDir, "proposal.md"),
      "# Title\n\n## Why\n\nBecause reasons.\n\n## What Changes\n\n- Thing 1\n- Thing 2\n",
      "utf-8",
    );
    writeFileSync(
      join(changeDir, "design.md"),
      "# Design\n\nFirst paragraph of design.\n\nLater stuff.\n",
      "utf-8",
    );

    const m = makeMutations();
    const id = await postPlanCommentOnce({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      log: () => {},
      mutations: m,
    });
    expect(id).toBe("c-1");
    expect(m.createdBodies[0]!.body).toContain("Because reasons.");
    expect(m.createdBodies[0]!.body).toContain("Thing 1");
    expect(m.createdBodies[0]!.body).toContain("First paragraph of design.");
    const s = await readState();
    expect((s.linearComments as { planCommentId?: string }).planCommentId).toBe("c-1");
    expect((s.linearComments as { planPostedAt?: string }).planPostedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // Second invocation is a no-op.
    const id2 = await postPlanCommentOnce({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      log: () => {},
      mutations: m,
    });
    expect(id2).toBeNull();
    expect(m.createdBodies.length).toBe(1);
  });

  test("skips when planning is not yet complete", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [ ] a\n", "utf-8");
    writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nx\n## What Changes\n\ny\n", "utf-8");
    const m = makeMutations();
    const id = await postPlanCommentOnce({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      log: () => {},
      mutations: m,
    });
    expect(id).toBeNull();
    expect(m.createdBodies.length).toBe(0);
  });
});

describe("postSteeringAndRefreshTasks", () => {
  test("posts steering comment, deletes prior tasks comment, recreates it", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Planning\n\n- [ ] one\n", "utf-8");
    const m = makeMutations();
    // Seed with an existing tasks comment.
    await postOrUpdateTasksComment({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 1,
      log: () => {},
      mutations: m,
    });
    expect(m.createdBodies.length).toBe(1);

    await postSteeringAndRefreshTasks({
      apiKey: "key",
      issueId: "issue-1",
      statePath,
      changeDir,
      changeName: "demo",
      iteration: 2,
      message: "Watch out for the X edge case",
      log: () => {},
      mutations: m,
    });

    // One steering comment created + one tasks comment recreated.
    expect(m.createdBodies.length).toBe(3);
    expect(m.createdBodies[1]!.body).toContain("Watch out for the X edge case");
    expect(m.createdBodies[2]!.body).toContain("- [ ] one");
    // Old tasks comment was deleted.
    expect(m.deletedIds).toEqual(["c-1"]);
    const s = await readState();
    expect((s.linearComments as { tasksCommentId?: string }).tasksCommentId).toBe("c-3");
  });
});
