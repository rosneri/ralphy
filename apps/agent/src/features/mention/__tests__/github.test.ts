import { describe, expect, test } from "bun:test";
import { fetchGithubIssueComments, fetchPrIssueComments, postGithubIssueComment } from "../github";
import type { CmdRunner } from "../../../agent/pr";

function makeRunner(
  stdout: string,
  opts: { throwOnGet?: boolean } = {},
): {
  runner: CmdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (argv) => {
      calls.push(argv);
      if (opts.throwOnGet && !argv.includes("-X")) throw new Error("gh boom");
      return { stdout, stderr: "" };
    },
  };
  return { runner, calls };
}

const SAMPLE = JSON.stringify([
  {
    id: 42,
    body: "@ralphy hi",
    createdAt: "2026-02-01T00:00:00.000Z",
    author: "alice",
    url: "https://github.com/acme/widgets/issues/7#issuecomment-42",
  },
]);

describe("fetchGithubIssueComments", () => {
  test("hits the REST issue-comments endpoint and parses the rows", async () => {
    const { runner, calls } = makeRunner(SAMPLE);
    const out = await fetchGithubIssueComments(runner, "/r", "acme/widgets", 7, () => {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 42, author: "alice" });
    expect(calls[0]?.join(" ")).toContain("repos/acme/widgets/issues/7/comments");
    // It is a GET (no -X POST).
    expect(calls[0]?.includes("-X")).toBe(false);
  });

  test("fails soft to [] and logs on a gh error", async () => {
    const { runner } = makeRunner("", { throwOnGet: true });
    const logs: string[] = [];
    const out = await fetchGithubIssueComments(runner, "/r", "acme/widgets", 7, (m) =>
      logs.push(m),
    );
    expect(out).toEqual([]);
    expect(logs.some((l) => l.includes("gh comments failed"))).toBe(true);
  });
});

describe("fetchPrIssueComments delegation", () => {
  test("derives owner/repo/number from the PR url and reuses the issue-comments fetch", async () => {
    const { runner, calls } = makeRunner(SAMPLE);
    const out = await fetchPrIssueComments(
      runner,
      "/r",
      "https://github.com/acme/widgets/pull/9",
      () => {},
    );
    expect(out).toHaveLength(1);
    expect(calls[0]?.join(" ")).toContain("repos/acme/widgets/issues/9/comments");
  });

  test("returns [] for a non-PR url without shelling out", async () => {
    const { runner, calls } = makeRunner(SAMPLE);
    const out = await fetchPrIssueComments(runner, "/r", "not-a-url", () => {});
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("postGithubIssueComment", () => {
  test("POSTs the body to the issue-comments endpoint", async () => {
    const { runner, calls } = makeRunner("");
    await postGithubIssueComment(runner, "/r", "acme/widgets", 7, "hello", () => {});
    const argv = calls[0] ?? [];
    expect(argv).toContain("-X");
    expect(argv.join(" ")).toContain("repos/acme/widgets/issues/7/comments");
    expect(argv.join(" ")).toContain("body=hello");
  });
});
