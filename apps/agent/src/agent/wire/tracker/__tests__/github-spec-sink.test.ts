import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStickyComment, parseRalphyMarker } from "@ralphy/comms";
import type { CmdRunner } from "../../../pr";
import { createGithubSpecSink } from "../github-spec-sink";

let tempDir: string;
let changeDir: string;
let statePath: string;

const DESIGN = "# Design\n\nThe living design paragraph.\n";
const TASKS =
  "# Tasks for demo\n\n## Planning\n\n- [x] plan\n\n## Implementation\n\n- [ ] build the thing\n";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "github-spec-sink-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  statePath = join(tempDir, ".ralph", "tasks", "demo", ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
  mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface StoredComment {
  id: string;
  body: string;
}

/** Stateful gh CmdRunner backing an in-memory comment store, so repeated sink
 *  calls exercise the real list → find → edit/create flow. */
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
      throw new Error("unexpected gh call");
    },
  };
  return { runner, calls, comments: () => store };
}

const diag = () => {};
const log = () => {};

function writeChangeFiles(design = DESIGN, tasks = TASKS): void {
  writeFileSync(join(changeDir, "design.md"), design, "utf-8");
  writeFileSync(join(changeDir, "tasks.md"), tasks, "utf-8");
}

function sink(runner: CmdRunner) {
  return createGithubSpecSink({
    cmdRunner: runner,
    repo: "acme/widgets",
    projectRoot: tempDir,
    diag,
  });
}

function ctx() {
  return { issueId: "42", statePath, changeDir, iteration: 1, log };
}

describe("createGithubSpecSink", () => {
  test("first sync creates a type=spec comment with the composed design markdown", async () => {
    writeChangeFiles();
    const { runner, calls, comments } = ghStore();
    await sink(runner).sync(ctx());

    expect(comments()).toHaveLength(1);
    const body = comments()[0]!.body;
    expect(parseRalphyMarker(body)?.type).toBe("spec");
    expect(parseRalphyMarker(body)?.fields.change).toBe("demo");
    // Composed doc: design.md + the tasks.md ## Implementation section.
    expect(body).toContain("The living design paragraph.");
    expect(body).toContain("## Implementation");
    expect(body).toContain("build the thing");
    // The ## Planning checklist must never leak.
    expect(body).not.toContain("## Planning");
    // Created via `gh issue comment`, no edit mutation.
    expect(calls.some((c) => c.slice(0, 3).join(" ") === "gh api graphql")).toBe(false);
  });

  test("write → read round-trips the embedded design markdown", async () => {
    writeChangeFiles();
    const { runner } = ghStore();
    const s = sink(runner);
    await s.sync(ctx());
    const read = await s.read({ issueId: "42" });
    expect(read).not.toBeNull();
    expect(read).toContain("The living design paragraph.");
    expect(read).toContain("build the thing");
    // The wrapper title and hidden marker are stripped.
    expect(read).not.toContain("🤖 Ralphy");
    expect(read).not.toContain("ralphy:");
  });

  test("unchanged content (matching sidecar hash) performs no gh mutation", async () => {
    writeChangeFiles();
    const { runner, calls } = ghStore();
    const s = sink(runner);
    await s.sync(ctx());
    const after = calls.length;
    await s.sync(ctx());
    // Second sync short-circuits on the persisted hash — no further gh calls.
    expect(calls.length).toBe(after);
  });

  test("changed content with an existing spec comment edits in place (no second create)", async () => {
    writeChangeFiles();
    const { runner, calls, comments } = ghStore();
    const s = sink(runner);
    await s.sync(ctx());

    writeFileSync(join(changeDir, "design.md"), "# Design\n\nRevised paragraph.\n", "utf-8");
    await s.sync(ctx());

    // Still exactly one spec comment, edited in place.
    expect(comments().filter((c) => parseRalphyMarker(c.body)?.type === "spec")).toHaveLength(1);
    expect(findStickyComment(comments(), "spec")?.body).toContain("Revised paragraph.");
    const creates = calls.filter((c) => c.slice(0, 3).join(" ") === "gh issue comment");
    expect(creates).toHaveLength(1);
    expect(calls.some((c) => c.slice(0, 3).join(" ") === "gh api graphql")).toBe(true);
  });

  test("scaffold-only design.md → no gh write", async () => {
    // Headings + italic placeholder only — fails hasMeaningfulContent.
    writeChangeFiles("# Design\n\n_To be written._\n", TASKS);
    const { runner, calls, comments } = ghStore();
    await sink(runner).sync(ctx());
    expect(comments()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("a gh failure is swallowed (sync resolves, no throw)", async () => {
    writeChangeFiles();
    const runner: CmdRunner = {
      run: async () => {
        throw new Error("gh: rate limited");
      },
    };
    await expect(sink(runner).sync(ctx())).resolves.toBeUndefined();
  });

  test("accepts a lazy repo resolver", async () => {
    writeChangeFiles();
    const { runner, calls } = ghStore();
    const s = createGithubSpecSink({
      cmdRunner: runner,
      repo: async () => "acme/widgets",
      projectRoot: tempDir,
      diag,
    });
    await s.sync(ctx());
    const created = calls.find((c) => c.slice(0, 3).join(" ") === "gh issue comment")!;
    expect(created).toContain("acme/widgets");
  });
});
