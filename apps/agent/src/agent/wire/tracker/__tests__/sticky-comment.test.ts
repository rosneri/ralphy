import { describe, expect, test } from "bun:test";
import { buildRalphyComment, findStickyComment, parseRalphyMarker } from "@ralphy/comms";
import type { CmdRunner } from "../../../pr";
import { upsertStickyComment } from "../sticky-comment";

interface StoredComment {
  id: string;
  body: string;
}

/**
 * A stateful gh CmdRunner that backs an in-memory comment store, so repeated
 * `upsertStickyComment` calls exercise the real list → find → edit/create flow.
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
        const id = cmd.find((a) => a.startsWith("id="))!.slice(3);
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

function deps(runner: CmdRunner, body: string) {
  return {
    cmdRunner: runner,
    repo: "acme/widgets",
    projectRoot: "/repo",
    issueNumber: "42",
    type: "attachment" as const,
    body,
    diag,
  };
}

const attachmentComment = (action: string) =>
  buildRalphyComment({ type: "attachment", action, fields: { change: "rlf-237" } });

describe("upsertStickyComment", () => {
  test("creates the comment when none exists", async () => {
    const { runner, calls, comments } = ghStore();
    const body = attachmentComment("design ready");
    await upsertStickyComment(deps(runner, body));

    expect(comments()).toHaveLength(1);
    expect(comments()[0]!.body).toBe(body);
    // No edit mutation when creating.
    expect(calls.some((c) => c.slice(0, 3).join(" ") === "gh api graphql")).toBe(false);
    const createCall = calls.find((c) => c.slice(0, 3).join(" ") === "gh issue comment")!;
    expect(createCall).toContain("--repo");
    expect(createCall).toContain("acme/widgets");
  });

  test("edits the existing comment in place when present", async () => {
    const existing = { id: "IC_99", body: attachmentComment("old subtitle") };
    const { runner, calls, comments } = ghStore([existing]);
    const body = attachmentComment("new subtitle");
    await upsertStickyComment(deps(runner, body));

    expect(comments()).toHaveLength(1);
    expect(comments()[0]!.id).toBe("IC_99");
    expect(comments()[0]!.body).toBe(body);
    const editCall = calls.find((c) => c.slice(0, 3).join(" ") === "gh api graphql")!;
    expect(editCall).toBeDefined();
    expect(editCall).toContain("id=IC_99");
    expect(editCall).toContain(`body=${body}`);
    // No new comment created.
    expect(calls.some((c) => c.slice(0, 3).join(" ") === "gh issue comment")).toBe(false);
  });

  test("N applies converge on one comment carrying the latest body", async () => {
    const { runner, comments } = ghStore();
    for (const action of ["first", "second", "third"]) {
      await upsertStickyComment(deps(runner, attachmentComment(action)));
    }
    const store = comments();
    const stuck = store.filter((c) => parseRalphyMarker(c.body)?.type === "attachment");
    expect(stuck).toHaveLength(1);
    expect(findStickyComment(store, "attachment")?.body).toBe(attachmentComment("third"));
  });

  test("swallows a gh list failure without throwing", async () => {
    const runner: CmdRunner = {
      run: async () => {
        throw new Error("gh: rate limited");
      },
    };
    await expect(
      upsertStickyComment(deps(runner, attachmentComment("x"))),
    ).resolves.toBeUndefined();
  });

  test("swallows a gh create failure without throwing", async () => {
    const runner: CmdRunner = {
      run: async (cmd) => {
        if (cmd.slice(0, 3).join(" ") === "gh issue view") {
          return { stdout: JSON.stringify({ comments: [] }), stderr: "" };
        }
        throw new Error("gh: forbidden");
      },
    };
    await expect(
      upsertStickyComment(deps(runner, attachmentComment("x"))),
    ).resolves.toBeUndefined();
  });
});
