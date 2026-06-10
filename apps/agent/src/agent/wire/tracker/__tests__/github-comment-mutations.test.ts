import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildRalphyComment, findStickyComment, parseRalphyMarker } from "@ralphy/comms";
import type { CmdRunner } from "../../../pr";
import { createGithubCommentMutations } from "../github-comment-mutations";
import { postOrUpdateTasksComment, postPlanCommentOnce } from "../../../linear-sync/comment-sync";

interface StoredComment {
  id: string;
  body: string;
}

/**
 * A stateful gh CmdRunner backing an in-memory comment store, so repeated
 * mutation calls exercise the real list → find → edit/create/delete flow.
 */
function ghStore(initial: StoredComment[] = []): {
  runner: CmdRunner;
  calls: string[][];
  comments: () => StoredComment[];
} {
  const store: StoredComment[] = [...initial];
  const calls: string[][] = [];
  let nextId = initial.length + 1;
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const sig = cmd.slice(0, 3).join(" ");
      if (sig === "gh issue view") {
        return { stdout: JSON.stringify({ comments: store }), stderr: "" };
      }
      if (sig === "gh issue comment") {
        const bodyIdx = cmd.indexOf("--body");
        store.push({ id: `IC_${nextId++}`, body: cmd[bodyIdx + 1]! });
        return { stdout: "", stderr: "" };
      }
      if (sig === "gh api graphql") {
        const query = cmd.find((a) => a.startsWith("query="))!.slice(6);
        const id = cmd.find((a) => a.startsWith("id="))!.slice(3);
        if (query.includes("deleteIssueComment")) {
          const idx = store.findIndex((c) => c.id === id);
          if (idx >= 0) store.splice(idx, 1);
          return { stdout: "", stderr: "" };
        }
        const body = cmd.find((a) => a.startsWith("body="))!.slice(5);
        const target = store.find((c) => c.id === id)!;
        target.body = body;
        return { stdout: "", stderr: "" };
      }
      throw new Error("unexpected gh call", { cause: { cmd } });
    },
  };
  return { runner, calls, comments: () => store };
}

const diag = () => {};

function makeMutations(runner: CmdRunner) {
  return createGithubCommentMutations({
    cmdRunner: runner,
    projectRoot: "/repo",
    repo: async () => "acme/widgets",
    diag,
  });
}

const tasksComment = (action: string) =>
  buildRalphyComment({ type: "tasks", action, fields: { change: "rlf-238" } });

describe("createGithubCommentMutations", () => {
  describe("createIssueComment", () => {
    test("creates when absent and returns the new node id", async () => {
      const { runner, calls, comments } = ghStore();
      const body = tasksComment("task progress");
      const id = await makeMutations(runner).createIssueComment("", "42", body);

      expect(comments()).toHaveLength(1);
      expect(comments()[0]!.body).toBe(body);
      expect(id).toBe(comments()[0]!.id);
      const createCall = calls.find((c) => c.slice(0, 3).join(" ") === "gh issue comment")!;
      expect(createCall).toContain("--repo");
      expect(createCall).toContain("acme/widgets");
    });

    test("edits in place when present and returns the existing id (no duplicate)", async () => {
      const existing = { id: "IC_99", body: tasksComment("old") };
      const { runner, calls, comments } = ghStore([existing]);
      const body = tasksComment("new");
      const id = await makeMutations(runner).createIssueComment("", "42", body);

      expect(id).toBe("IC_99");
      expect(comments()).toHaveLength(1);
      expect(comments()[0]!.body).toBe(body);
      // Edit mutation issued, no fresh create.
      expect(calls.some((c) => c.includes("id=IC_99"))).toBe(true);
      expect(calls.some((c) => c.slice(0, 3).join(" ") === "gh issue comment")).toBe(false);
    });

    test("throws when the created comment id cannot be resolved", async () => {
      // gh issue comment succeeds but the store never reflects the new comment.
      const runner: CmdRunner = {
        run: async (cmd) => {
          if (cmd.slice(0, 3).join(" ") === "gh issue view") {
            return { stdout: JSON.stringify({ comments: [] }), stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      };
      await expect(
        makeMutations(runner).createIssueComment("", "42", tasksComment("x")),
      ).rejects.toThrow(/could not resolve/i);
    });
  });

  describe("updateIssueComment", () => {
    test("edits the comment by node id", async () => {
      const existing = { id: "IC_7", body: tasksComment("old") };
      const { runner, comments } = ghStore([existing]);
      const body = tasksComment("updated");
      await makeMutations(runner).updateIssueComment("", "IC_7", body);

      expect(comments()).toHaveLength(1);
      expect(comments()[0]!.body).toBe(body);
    });
  });

  describe("deleteIssueComment", () => {
    test("removes the comment by node id", async () => {
      const { runner, comments } = ghStore([
        { id: "IC_1", body: tasksComment("a") },
        { id: "IC_2", body: tasksComment("b") },
      ]);
      await makeMutations(runner).deleteIssueComment("", "IC_1");

      expect(comments().map((c) => c.id)).toEqual(["IC_2"]);
    });
  });
});

describe("github comment-sync integration over ghStore", () => {
  let tempDir: string;
  let changeDir: string;
  let statePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gh-comment-sync-"));
    changeDir = join(tempDir, "openspec", "changes", "rlf-238");
    statePath = join(tempDir, ".ralph", "tasks", "rlf-238", ".ralph-state.json");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] done\n\n## Implementation\n\n- [ ] build it\n",
    );
    writeFileSync(
      join(changeDir, "proposal.md"),
      "# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\nThings.\n",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function base() {
    return {
      apiKey: "",
      issueId: "42",
      statePath,
      changeDir,
      changeName: "rlf-238",
      log: () => {},
    };
  }

  test("repeated polls keep exactly one plan + one tasks comment, updating in place", async () => {
    const { runner, comments } = ghStore();
    const mutations = makeMutations(runner);

    // First poll: plan posted once, tasks created.
    await postPlanCommentOnce({ ...base(), mutations });
    await postOrUpdateTasksComment({ ...base(), mutations, iteration: 1 });

    // Second poll: tasks.md changed → tasks comment updated in place; plan suppressed.
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] done\n\n## Implementation\n\n- [x] build it\n",
    );
    await postPlanCommentOnce({ ...base(), mutations });
    await postOrUpdateTasksComment({ ...base(), mutations, iteration: 2 });

    const plans = comments().filter((c) => parseRalphyMarker(c.body)?.type === "plan");
    const tasks = comments().filter((c) => parseRalphyMarker(c.body)?.type === "tasks");
    expect(plans).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(findStickyComment(comments(), "tasks")!.body).toContain("build it");
  });

  test("clearing persisted ids does not produce duplicates (marker re-discovery)", async () => {
    const { runner, comments } = ghStore();
    const mutations = makeMutations(runner);

    await postOrUpdateTasksComment({ ...base(), mutations, iteration: 1 });
    expect(comments().filter((c) => parseRalphyMarker(c.body)?.type === "tasks")).toHaveLength(1);

    // Simulate wiped state: drop the persisted sidecar so the orchestrator has
    // no id and falls back to a fresh create — which must re-discover by marker.
    rmSync(join(dirname(statePath), ".ralph-state.linearComments.json"), { force: true });
    // Also change tasks.md so the sha256 fast-path does not short-circuit.
    writeFileSync(
      join(changeDir, "tasks.md"),
      "## Planning\n\n- [x] done\n\n## Implementation\n\n- [x] more\n",
    );

    await postOrUpdateTasksComment({ ...base(), mutations, iteration: 2 });

    const tasks = comments().filter((c) => parseRalphyMarker(c.body)?.type === "tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.body).toContain("more");
  });
});
