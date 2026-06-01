import { describe, expect, test } from "bun:test";
import { fetchPrReviewSummary } from "../review-state";
import type { CmdRunner } from "../../../agent/pr";

function makeRunner(stdout: string): CmdRunner {
  return {
    run: async () => ({ stdout, stderr: "" }),
  };
}

function makeErrorRunner(): CmdRunner {
  return {
    run: async () => {
      throw new Error("gh api failed");
    },
  };
}

const BASE_URL = "https://github.com/owner/repo/pull/42";

describe("fetchPrReviewSummary", () => {
  test("returns 0 for resolved-only threads", async () => {
    const payload = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: true }, { isResolved: true }],
            },
          },
        },
      },
    });
    const result = await fetchPrReviewSummary(BASE_URL, makeRunner(payload), "/cwd");
    expect(result).toEqual({ unresolved: 0 });
  });

  test("counts only unresolved in mixed threads", async () => {
    const payload = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }],
            },
          },
        },
      },
    });
    const result = await fetchPrReviewSummary(BASE_URL, makeRunner(payload), "/cwd");
    expect(result).toEqual({ unresolved: 2 });
  });

  test("counts an unresolved file-level thread (RLF-209)", async () => {
    const payload = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { isResolved: false, subjectType: "FILE" },
                { isResolved: true, subjectType: "LINE" },
              ],
            },
          },
        },
      },
    });
    const result = await fetchPrReviewSummary(BASE_URL, makeRunner(payload), "/cwd");
    expect(result).toEqual({ unresolved: 1 });
  });

  test("returns 0 for empty threads array", async () => {
    const payload = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [] },
          },
        },
      },
    });
    const result = await fetchPrReviewSummary(BASE_URL, makeRunner(payload), "/cwd");
    expect(result).toEqual({ unresolved: 0 });
  });

  test("returns null when runner throws (GraphQL error)", async () => {
    const result = await fetchPrReviewSummary(BASE_URL, makeErrorRunner(), "/cwd");
    expect(result).toBeNull();
  });

  test("returns null for invalid URL", async () => {
    const result = await fetchPrReviewSummary(
      "https://not-github.com/foo",
      makeRunner("{}"),
      "/cwd",
    );
    expect(result).toBeNull();
  });
});
