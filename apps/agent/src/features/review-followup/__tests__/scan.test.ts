/**
 * Tests for `scanCodeReview` digest labeling (RLF-209).
 *
 * The defect: a whole-file review comment (`subjectType: "FILE"`) is returned
 * by GitHub's `reviewThreads` with `line: 1` (or `line: null` when outdated).
 * The old digest rendered it as `<path>:1`, telling the worker the comment was
 * on line 1. The fix selects `subjectType` and labels file-level threads as a
 * whole-file comment without a misleading line anchor.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCodeReview } from "../scan";
import type { TrackedIssue } from "@ralphy/tracker";
import type { CmdRunner } from "../../../agent/pr";

const PR_URL = "https://github.com/owner/repo/pull/42";

function makeIssue(): TrackedIssue {
  return {
    id: "uuid-1",
    identifier: "RLF-209",
    title: "file level review",
    description: null,
    url: "https://linear.app/x/RLF-209",
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

interface ThreadFixture {
  subjectType?: string | null;
  path?: string | null;
  line?: number | null;
  isResolved?: boolean;
}

/** Build a GraphQL review-state payload with the given threads. */
function payloadFor(threads: ThreadFixture[], commentAt = "2026-05-15T10:00:00Z"): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          state: "OPEN",
          merged: false,
          reviewDecision: "CHANGES_REQUESTED",
          reviewRequests: { nodes: [] },
          latestReviews: {
            nodes: [
              { author: { login: "alice" }, state: "CHANGES_REQUESTED", submittedAt: commentAt },
            ],
          },
          reviewThreads: {
            nodes: threads.map((t) => ({
              isResolved: t.isResolved ?? false,
              subjectType: t.subjectType ?? "LINE",
              path: t.path ?? null,
              line: t.line ?? null,
              comments: {
                nodes: [
                  {
                    body: "please reconsider this module's structure",
                    author: { login: "alice" },
                    createdAt: commentAt,
                    url: `${PR_URL}#discussion_r1`,
                  },
                ],
              },
            })),
          },
        },
      },
    },
  });
}

function makeRunner(stdout: string): CmdRunner {
  return { run: async () => ({ stdout, stderr: "" }) };
}

const tmpRoots: string[] = [];

function makeDeps(stdout: string): Parameters<typeof scanCodeReview>[3] {
  const projectRoot = mkdtempSync(join(tmpdir(), "rlf209-scan-"));
  tmpRoots.push(projectRoot);
  return {
    cmdRunner: makeRunner(stdout),
    projectRoot,
    useWorktree: false,
    staleHours: 0,
    cwdOf: () => undefined,
    lastHandledReviewActivity: new Map<string, string>(),
    stalePingedAt: new Map<string, number>(),
    onLog: () => {},
  };
}

describe("scanCodeReview — whole-file review comments (RLF-209)", () => {
  afterAll(() => {
    for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  });

  test("bug_case: a FILE thread is NOT labeled with a :line anchor", async () => {
    const deps = makeDeps(payloadFor([{ subjectType: "FILE", path: "src/foo.ts", line: 1 }]));
    const trigger = await scanCodeReview(makeIssue(), PR_URL, null, deps);
    expect(trigger).not.toBeNull();
    // The whole-file comment must NOT be anchored to line 1.
    expect(trigger!.body).not.toContain("src/foo.ts:1");
  });

  test("fix_case: a FILE thread (line: 1) is labeled as a whole-file comment", async () => {
    const deps = makeDeps(payloadFor([{ subjectType: "FILE", path: "src/foo.ts", line: 1 }]));
    const trigger = await scanCodeReview(makeIssue(), PR_URL, null, deps);
    expect(trigger).not.toBeNull();
    expect(trigger!.body).toContain("src/foo.ts (whole file)");
    expect(trigger!.body).toContain("please reconsider this module's structure");
    expect(trigger!.body).toContain("alice");
  });

  test("fix_case: a FILE thread (line: null) is still labeled as a whole-file comment", async () => {
    const deps = makeDeps(payloadFor([{ subjectType: "FILE", path: "src/foo.ts", line: null }]));
    const trigger = await scanCodeReview(makeIssue(), PR_URL, null, deps);
    expect(trigger).not.toBeNull();
    expect(trigger!.body).toContain("src/foo.ts (whole file)");
    expect(trigger!.body).not.toContain("src/foo.ts:");
  });

  test("regression: a LINE thread keeps its <path>:<line> label", async () => {
    const deps = makeDeps(payloadFor([{ subjectType: "LINE", path: "src/foo.ts", line: 42 }]));
    const trigger = await scanCodeReview(makeIssue(), PR_URL, null, deps);
    expect(trigger).not.toBeNull();
    expect(trigger!.body).toContain("src/foo.ts:42");
    expect(trigger!.body).not.toContain("whole file");
  });

  test("regression: a thread with absent subjectType keeps line rendering", async () => {
    const deps = makeDeps(payloadFor([{ subjectType: null, path: "src/foo.ts", line: 7 }]));
    const trigger = await scanCodeReview(makeIssue(), PR_URL, null, deps);
    expect(trigger).not.toBeNull();
    expect(trigger!.body).toContain("src/foo.ts:7");
    expect(trigger!.body).not.toContain("whole file");
  });
});
