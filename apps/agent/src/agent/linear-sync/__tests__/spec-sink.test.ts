/**
 * RLF-239 — SpecSink seam tests.
 *
 *  - Comment-embedded sink (GitHub): spec content is written to and re-read
 *    from an issue comment; unchanged content is a no-op; changed content
 *    edits the single sticky comment in place.
 *  - Attachment sink (Linear): unchanged `syncSpecAttachments` behavior,
 *    driven through the tracker's `attachments` capability.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRalphyMarker } from "@ralphy/comms";
import { InMemoryIssueTracker, makeTrackedIssue } from "@ralphy/tracker/testing";
import type { CmdRunner } from "@ralphy/codehost";
import {
  attachmentMutationsFromCapability,
  createAttachmentSpecSink,
  createCommentSpecSink,
  SPEC_COMMENT_TYPE,
  type SpecSink,
} from "../spec-sink";
import { createGithubCommentSpecSink } from "../../wire/comment-sync";

let tempDir: string;
let changeDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spec-sink-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  statePath = join(tempDir, ".ralph", "tasks", "demo", ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
  mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeDesign(content: string, tasks?: string): void {
  writeFileSync(join(changeDir, "design.md"), content);
  if (tasks !== undefined) writeFileSync(join(changeDir, "tasks.md"), tasks);
}

const logs: string[] = [];
const log = (text: string): void => {
  logs.push(text);
};

function syncInput(issueId = "42", iteration = 1) {
  return { issueId, statePath, changeDir, iteration, log };
}

/** Comment sink wired over the in-memory tracker's sticky primitives. */
function trackerBackedSink(tracker: InMemoryIssueTracker): SpecSink {
  return createCommentSpecSink({
    upsertStickyComment: (issueId, type, body) =>
      tracker.upsertStickyComment(makeTrackedIssue({ id: issueId }), type, body),
    readStickyComment: async (issueId, type) => tracker.stickyComment(issueId, type)?.body ?? null,
  });
}

describe("createCommentSpecSink", () => {
  test("writes the spec content into a sticky comment and re-reads it to skip an unchanged re-sync", async () => {
    writeDesign("# Design\n\nA real design body.\n", "## Implementation\n- [ ] do the thing\n");
    const tracker = new InMemoryIssueTracker();
    const sink = trackerBackedSink(tracker);

    await sink.sync(syncInput());
    const comment = tracker.stickyComment("42", SPEC_COMMENT_TYPE);
    expect(comment).not.toBeNull();
    expect(comment!.body).toContain("A real design body.");
    expect(comment!.body).toContain("- [ ] do the thing");
    const sha = parseRalphyMarker(comment!.body)?.fields.sha;
    expect(sha).toBeTruthy();

    // Unchanged content: the sink re-reads the published sha and skips.
    logs.length = 0;
    await sink.sync(syncInput("42", 2));
    expect(logs.some((l) => l.includes("unchanged, skipping"))).toBe(true);
    expect(tracker.commentsByIssue.get("42")).toHaveLength(1);
    expect(tracker.stickyComment("42", SPEC_COMMENT_TYPE)!.body).toBe(comment!.body);
  });

  test("changed content edits the single sticky comment in place", async () => {
    writeDesign("# Design\n\nVersion one.\n");
    const tracker = new InMemoryIssueTracker();
    const sink = trackerBackedSink(tracker);
    await sink.sync(syncInput());

    writeDesign("# Design\n\nVersion two.\n");
    await sink.sync(syncInput("42", 2));

    const comments = tracker.commentsByIssue.get("42")!;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("Version two.");
    expect(comments[0]!.body).not.toContain("Version one.");
  });

  test("scaffold-only design.md publishes nothing", async () => {
    writeDesign("# Title\n\n_placeholder_\n\nStatus: todo\n");
    const tracker = new InMemoryIssueTracker();
    await trackerBackedSink(tracker).sync(syncInput());
    expect(tracker.commentsByIssue.get("42")).toBeUndefined();
  });

  test("gh-backed sink: creates the issue comment, then edits it in place on change", async () => {
    writeDesign("# Design\n\nReal content v1.\n");
    const comments: { id: string; body: string }[] = [];
    const calls: string[][] = [];
    const cmdRunner: CmdRunner = {
      run: async (cmd) => {
        calls.push(cmd);
        const joined = cmd.join(" ");
        if (joined.startsWith("gh issue view")) {
          return { stdout: JSON.stringify({ comments }), stderr: "" };
        }
        if (joined.startsWith("gh issue comment")) {
          comments.push({ id: `c${comments.length + 1}`, body: cmd[cmd.indexOf("--body") + 1]! });
          return { stdout: "", stderr: "" };
        }
        if (joined.startsWith("gh api graphql")) {
          const id = cmd.find((a) => a.startsWith("id="))!.slice(3);
          const body = cmd.find((a) => a.startsWith("body="))!.slice(5);
          const target = comments.find((c) => c.id === id)!;
          target.body = body;
          return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    };
    const sink = createGithubCommentSpecSink({
      cmdRunner,
      projectRoot: tempDir,
      repo: async () => "owner/repo",
      diag: () => {},
    });

    await sink.sync(syncInput("7"));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("Real content v1.");
    expect(parseRalphyMarker(comments[0]!.body)?.type).toBe("spec");

    writeDesign("# Design\n\nReal content v2.\n");
    await sink.sync(syncInput("7", 2));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("Real content v2.");
    // The second sync edited in place via the GraphQL mutation, not a new comment.
    expect(calls.filter((c) => c.join(" ").startsWith("gh issue comment"))).toHaveLength(1);
    expect(calls.some((c) => c.join(" ").startsWith("gh api graphql"))).toBe(true);
  });
});

describe("createAttachmentSpecSink over the attachments capability", () => {
  test("uploads the composed spec and attaches it to the issue (Linear shape unchanged)", async () => {
    writeDesign("# Design\n\nAttachment-bound body.\n", "## Implementation\n- [ ] task A\n");
    const tracker = new InMemoryIssueTracker({ withAttachments: true });
    const sink = createAttachmentSpecSink({
      apiKey: "key",
      mutations: attachmentMutationsFromCapability(tracker.attachments!),
      formats: ["md"],
    });

    await sink.sync(syncInput("lin-1"));
    expect(tracker.uploads).toHaveLength(1);
    expect(tracker.uploads[0]!.filename).toBe("design.md");
    const uploaded = new TextDecoder().decode(tracker.uploads[0]!.bytes);
    expect(uploaded).toContain("Attachment-bound body.");
    expect(uploaded).toContain("- [ ] task A");
    expect(tracker.attachmentsStore).toHaveLength(1);
    expect(tracker.attachmentsStore[0]!.title).toBe("Ralph design");
    expect(tracker.attachmentsStore[0]!.issueId).toBe("lin-1");

    // Unchanged content: hash skip, no second upload.
    await sink.sync(syncInput("lin-1", 2));
    expect(tracker.uploads).toHaveLength(1);
    expect(tracker.attachmentsStore).toHaveLength(1);
  });
});
