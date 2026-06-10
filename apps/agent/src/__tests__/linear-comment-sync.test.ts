import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  postOrUpdateTasksComment,
  postPlanCommentOnce,
  postSteeringAndRefreshTasks,
  parsePlanningSection,
  isCommentNotFoundError,
  type CommentMutations,
} from "../agent/linear-sync/comment-sync";
import { createCommentSyncHooks } from "../agent/wire/comment-sync";
import { createLinearSpecSink, type SpecSink } from "../agent/linear-sync/spec-sink";
import {
  uploadFileToLinear,
  createAttachmentForUrl,
  deleteAttachment,
  findIssueAttachmentByTitle,
} from "../agent/linear";
import type { RalphyConfig } from "../agent/config";
import { WorkflowConfigSchema } from "@ralphy/workflow";

/** Build the Linear design-doc sink the way wire.ts does, so these hook-level
 *  tests exercise the same Linear attachment path through the injected seam. */
function makeLinearSink(cfg: RalphyConfig): SpecSink {
  return createLinearSpecSink({
    apiKey: "test-key",
    mutations: {
      uploadFileToLinear,
      createAttachmentForUrl,
      deleteAttachment,
      findIssueAttachmentByTitle,
    },
    ...(cfg.linear.specAttachmentFormats ? { formats: cfg.linear.specAttachmentFormats } : {}),
    ...(cfg.linear.specAttachmentRevisions
      ? { sealedRevisionMode: cfg.linear.specAttachmentRevisions }
      : {}),
  });
}

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

// linearComments now lives in its own sidecar (`.ralph-state.linearComments.json`),
// written single-writer via writeField. Prefer the sidecar; fall back to a
// legacy inline copy in the core file.
async function readState(): Promise<{ linearComments?: Record<string, unknown> }> {
  const sidecar = join(dirname(statePath), ".ralph-state.linearComments.json");
  if (await Bun.file(sidecar).exists()) {
    return {
      linearComments: JSON.parse(await Bun.file(sidecar).text()) as Record<string, unknown>,
    };
  }
  if (await Bun.file(statePath).exists()) {
    return JSON.parse(await Bun.file(statePath).text()) as {
      linearComments?: Record<string, unknown>;
    };
  }
  return {};
}

describe("parsePlanningSection", () => {
  test("returns allChecked when all Planning items are done", () => {
    const md = "## Planning\n\n- [x] a\n- [x] b\n\n## Implementation\n\n- [ ] x\n";
    expect(parsePlanningSection(md).allChecked).toBe(true);
  });

  test("returns false when any Planning item is unchecked", () => {
    const md = "## Planning\n\n- [x] a\n- [ ] b\n";
    expect(parsePlanningSection(md).allChecked).toBe(false);
  });

  test("returns false when no Planning section exists", () => {
    expect(parsePlanningSection("## Implementation\n\n- [x] z\n").allChecked).toBe(false);
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
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] one\n", "utf-8");
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
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] one\n", "utf-8");
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
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [x] one\n", "utf-8");
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
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] one\n", "utf-8");
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
    // Change tasks.md so the hash-skip doesn't short-circuit the update path.
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [x] one\n", "utf-8");
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

  test("hash-skips the update when tasks.md is unchanged (RLF: no-op churn)", async () => {
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] one\n", "utf-8");
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
    // Same content, next iteration: must not call updateIssueComment.
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
    expect(m.updatedBodies.length).toBe(0);
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
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] one\n", "utf-8");
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

describe("createCommentSyncHooks — syncTasks: plan comment suppression with spec attachments", () => {
  let savedFetch: typeof globalThis.fetch;

  function makeWireConfig(syncSpecsAsAttachments: boolean): RalphyConfig {
    return WorkflowConfigSchema.parse({
      linear: { syncTasksToComment: true, syncSpecsAsAttachments },
    });
  }

  function installFetchStub(): void {
    let cmt = 0;
    let att = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") {
        return new Response("", { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      const q = body.query ?? "";
      if (q.includes("commentCreate")) {
        return new Response(
          JSON.stringify({
            data: { commentCreate: { success: true, comment: { id: `cmt-${++cmt}` } } },
          }),
        );
      }
      if (q.includes("fileUpload")) {
        return new Response(
          JSON.stringify({
            data: {
              fileUpload: {
                uploadFile: {
                  uploadUrl: "https://upload.example.com/put",
                  assetUrl: "https://assets.example.com/file.md",
                  headers: [],
                },
              },
            },
          }),
        );
      }
      if (q.includes("IssueAttachmentByTitle") || q.includes("attachments(first")) {
        return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
      }
      if (q.includes("CreateAttachment") || q.includes("attachmentCreate")) {
        return new Response(
          JSON.stringify({
            data: { attachmentCreate: { success: true, attachment: { id: `att-${++att}` } } },
          }),
        );
      }
      return new Response(JSON.stringify({ data: {} }));
    }) as typeof fetch;
  }

  function writeChangeFiles(): void {
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] design approved\n\n## Implementation\n\n- [ ] task one\n",
      "utf-8",
    );
    writeFileSync(
      join(changeDir, "proposal.md"),
      "# Title\n\n## Why\n\nBecause reasons.\n\n## What Changes\n\n- Change item\n",
      "utf-8",
    );
    writeFileSync(join(changeDir, "design.md"), "# Design\n\nDesign paragraph here.\n", "utf-8");
  }

  async function runSyncTasks(cfg: RalphyConfig): Promise<void> {
    const hooks = createCommentSyncHooks({
      apiKey: "test-key",
      cfg,
      projectRoot: tempDir,
      onLog: () => {},
      diag: () => {},
      cwdByChange: new Map(),
      issueByChange: new Map(),
      specSink: makeLinearSink(cfg),
    });
    await hooks.syncTasks!({ changeName: "demo", issueId: "issue-1" }, 1);
  }

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    installFetchStub();
    writeChangeFiles();
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  test("bug_case: plan comment is NOT assigned a real id when spec attachments enabled (regression guard)", async () => {
    await runSyncTasks(makeWireConfig(true));
    const s = await readState();
    // After the fix, postPlanCommentOnce is skipped — planCommentId stays null (not a real comment id).
    expect((s.linearComments as { planCommentId?: string | null }).planCommentId).toBeNull();
  });

  test("fix_case: plan comment is NOT created when spec attachments enabled", async () => {
    await runSyncTasks(makeWireConfig(true));
    const s = await readState();
    expect((s.linearComments as { planCommentId?: string | null }).planCommentId).toBeNull();
  });

  test("plan comment IS created when spec attachments disabled", async () => {
    await runSyncTasks(makeWireConfig(false));
    const s = await readState();
    expect((s.linearComments as { planCommentId?: string | null }).planCommentId).toBeTruthy();
  });
});

describe("createCommentSyncHooks — spec attachments decoupled from syncTasksToComment", () => {
  let savedFetch: typeof globalThis.fetch;
  let uploadCalls: number;
  let attachmentCreateCalls: number;

  function makeWireConfig(opts: {
    syncTasksToComment: boolean;
    syncSpecsAsAttachments: boolean;
  }): RalphyConfig {
    return WorkflowConfigSchema.parse({
      linear: {
        syncTasksToComment: opts.syncTasksToComment,
        syncSpecsAsAttachments: opts.syncSpecsAsAttachments,
        specAttachmentFormats: ["pdf"],
      },
    });
  }

  function installFetchStub(): void {
    let cmt = 0;
    let att = 0;
    uploadCalls = 0;
    attachmentCreateCalls = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") {
        return new Response("", { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      const q = body.query ?? "";
      if (q.includes("commentCreate")) {
        return new Response(
          JSON.stringify({
            data: { commentCreate: { success: true, comment: { id: `cmt-${++cmt}` } } },
          }),
        );
      }
      if (q.includes("fileUpload")) {
        uploadCalls++;
        return new Response(
          JSON.stringify({
            data: {
              fileUpload: {
                uploadFile: {
                  uploadUrl: "https://upload.example.com/put",
                  assetUrl: "https://assets.example.com/file.pdf",
                  headers: [],
                },
              },
            },
          }),
        );
      }
      if (q.includes("IssueAttachmentByTitle") || q.includes("attachments(first")) {
        return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
      }
      if (q.includes("CreateAttachment") || q.includes("attachmentCreate")) {
        attachmentCreateCalls++;
        return new Response(
          JSON.stringify({
            data: { attachmentCreate: { success: true, attachment: { id: `att-${++att}` } } },
          }),
        );
      }
      return new Response(JSON.stringify({ data: {} }));
    }) as typeof fetch;
  }

  function writeChangeFiles(): void {
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] design approved\n\n## Implementation\n\n- [ ] task one\n",
      "utf-8",
    );
    writeFileSync(
      join(changeDir, "proposal.md"),
      "# Title\n\n## Why\n\nBecause reasons.\n\n## What Changes\n\n- Change item\n",
      "utf-8",
    );
    writeFileSync(join(changeDir, "design.md"), "# Design\n\nDesign paragraph here.\n", "utf-8");
  }

  function makeHooks(cfg: RalphyConfig) {
    return createCommentSyncHooks({
      apiKey: "test-key",
      cfg,
      projectRoot: tempDir,
      onLog: () => {},
      diag: () => {},
      cwdByChange: new Map(),
      issueByChange: new Map(),
      specSink: makeLinearSink(cfg),
    });
  }

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    installFetchStub();
    writeChangeFiles();
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  test("fix_case: syncTasks is wired when only syncSpecsAsAttachments is on", () => {
    const hooks = makeHooks(
      makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: true }),
    );
    expect(hooks.enabled).toBe(true);
    expect(typeof hooks.syncTasks).toBe("function");
  });

  test("fix_case: design attachment is uploaded with syncTasksToComment off", async () => {
    const hooks = makeHooks(
      makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: true }),
    );
    await hooks.syncTasks!({ changeName: "demo", issueId: "issue-1" }, 1);
    expect(uploadCalls).toBeGreaterThan(0);
    expect(attachmentCreateCalls).toBeGreaterThan(0);
  });

  test("no tasks comment is posted when syncTasksToComment is off", async () => {
    const hooks = makeHooks(
      makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: true }),
    );
    await hooks.syncTasks!({ changeName: "demo", issueId: "issue-1" }, 1);
    const s = await readState();
    const lc = (s.linearComments ?? {}) as { tasksCommentId?: string | null };
    expect(lc.tasksCommentId ?? null).toBeNull();
  });

  test("bug_case: syncTasks must NOT fall back to projectRoot when worker.cwd is set (regression: missing design upload)", async () => {
    // The awaiting-reap flush runs after releaseWorkerMaps cleared cwdByChange,
    // so the only way the hook can find the worktree is via the worker itself.
    const worktree = mkdtempSync(join(tmpdir(), "comment-sync-wt-"));
    try {
      const wtChangeDir = join(worktree, "openspec", "changes", "demo");
      mkdirSync(wtChangeDir, { recursive: true });
      writeFileSync(
        join(wtChangeDir, "tasks.md"),
        "## Planning\n\n- [x] design approved\n\n## Implementation\n\n- [ ] task one\n",
        "utf-8",
      );
      writeFileSync(
        join(wtChangeDir, "design.md"),
        "# Design\n\nDesign paragraph here.\n",
        "utf-8",
      );
      // projectRoot (tempDir) intentionally has NO design.md for this change.
      rmSync(join(changeDir, "design.md"), { force: true });

      const hooks = makeHooks(
        makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: true }),
      );
      await hooks.syncTasks!({ changeName: "demo", issueId: "issue-1", cwd: worktree }, 1);
      // Regression guard: worker.cwd used to be ignored → resolved projectRoot
      // → design.md missing → no upload (LIT-387 had no design attachment).
      expect(uploadCalls).not.toBe(0);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("fix_case: syncTasks uses worker.cwd when cwdByChange has no entry", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "comment-sync-wt-"));
    try {
      const wtChangeDir = join(worktree, "openspec", "changes", "demo");
      mkdirSync(wtChangeDir, { recursive: true });
      writeFileSync(
        join(wtChangeDir, "tasks.md"),
        "## Planning\n\n- [x] design approved\n\n## Implementation\n\n- [ ] task one\n",
        "utf-8",
      );
      writeFileSync(
        join(wtChangeDir, "design.md"),
        "# Design\n\nDesign paragraph here.\n",
        "utf-8",
      );
      rmSync(join(changeDir, "design.md"), { force: true });

      const hooks = makeHooks(
        makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: true }),
      );
      await hooks.syncTasks!({ changeName: "demo", issueId: "issue-1", cwd: worktree }, 1);
      expect(uploadCalls).toBeGreaterThan(0);
      expect(attachmentCreateCalls).toBeGreaterThan(0);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("hooks stay disabled when both comment sync and spec attachments are off", () => {
    const hooks = makeHooks(
      makeWireConfig({ syncTasksToComment: false, syncSpecsAsAttachments: false }),
    );
    expect(hooks.enabled).toBe(false);
    expect(hooks.syncTasks).toBeUndefined();
  });
});
