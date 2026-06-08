import { describe, expect, test } from "bun:test";
import type { CmdRunner } from "../../../pr";
import {
  createGithubTrackerProvider,
  githubIndicatorAction,
  mapGithubIssue,
  type GithubMarkerVocab,
} from "../github-tracker-provider";

const VOCAB: GithubMarkerVocab = {
  selectionLabel: "ralphy:todo",
  inProgressLabel: "status:in-progress",
  reviewLabel: "ralphy:review",
  lifecycleLabels: ["status:in-progress", "ralphy:review", "status:pr-ready", "status:error"],
};

/** Records every argv and replays canned stdout in FIFO order. */
function scriptedRunner(stdouts: string[] = []): { runner: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      return { stdout: stdouts[i++] ?? "[]", stderr: "" };
    },
  };
  return { runner, calls };
}

function makeProvider(stdouts: string[] = []) {
  const { runner, calls } = scriptedRunner(stdouts);
  const client = createGithubTrackerProvider({
    runner,
    cwd: "/tmp/repo",
    repo: "acme/widgets",
    vocab: VOCAB,
  });
  return { client, calls };
}

const issueJson = (
  over: Partial<{
    number: number;
    state: string;
    labels: { name: string }[];
  }> = {},
) =>
  JSON.stringify([
    {
      number: over.number ?? 7,
      title: "an issue",
      body: "body text",
      url: "https://github.com/acme/widgets/issues/7",
      state: over.state ?? "OPEN",
      labels: over.labels ?? [{ name: "ralphy:todo" }],
      assignees: [{ login: "octocat", name: "Octo Cat", id: "u1" }],
      createdAt: "2025-01-01T00:00:00Z",
    },
  ]);

describe("mapGithubIssue", () => {
  test("maps number, labels, assignee and open state", () => {
    const issue = mapGithubIssue({
      number: 42,
      title: "hi",
      body: "desc",
      url: "u",
      state: "OPEN",
      labels: [{ name: "a" }, { name: "b" }],
      assignees: [{ login: "octo", name: "Octo", id: "x" }],
    });
    expect(issue.id).toBe("42");
    expect(issue.identifier).toBe("#42");
    expect(issue.description).toBe("desc");
    expect(issue.labels).toEqual(["a", "b"]);
    expect(issue.assignee).toEqual({ id: "x", email: null, name: "Octo" });
    expect(issue.state).toEqual({ name: "Open", type: "started" });
  });

  test("closed issue maps to type completed", () => {
    const issue = mapGithubIssue({ number: 1, state: "CLOSED" });
    expect(issue.state).toEqual({ name: "Closed", type: "completed" });
  });

  test("missing assignees yields null", () => {
    expect(mapGithubIssue({ number: 1 }).assignee).toBeNull();
  });
});

describe("githubIndicatorAction", () => {
  test("done label classifies as close", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:done" })).toEqual({
      kind: "close",
    });
  });

  test("done status classifies as close", () => {
    expect(githubIndicatorAction({ type: "status", value: "Done" })).toEqual({ kind: "close" });
  });

  test("non-done label classifies as add-label", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:in-progress" })).toEqual({
      kind: "add-label",
      labels: ["status:in-progress"],
    });
  });

  test("remove op never resolves to close", () => {
    expect(githubIndicatorAction({ type: "label", value: "status:done" }, "remove")).toEqual({
      kind: "remove-label",
      labels: ["status:done"],
    });
  });
});

describe("fetch buckets build correct gh argv", () => {
  test("fetchTodo lists open + selection label and drops lifecycle-labelled issues", async () => {
    const { client, calls } = makeProvider([
      JSON.stringify([
        { number: 1, state: "OPEN", labels: [{ name: "ralphy:todo" }] },
        {
          number: 2,
          state: "OPEN",
          labels: [{ name: "ralphy:todo" }, { name: "status:in-progress" }],
        },
      ]),
    ]);
    const todo = await client.fetchTodo();
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "ralphy:todo",
      "--json",
      "number,title,body,url,state,labels,assignees,createdAt",
      "--repo",
      "acme/widgets",
    ]);
    expect(todo.map((i) => i.identifier)).toEqual(["#1"]);
  });

  test("fetchInProgress filters by in-progress label", async () => {
    const { client, calls } = makeProvider([issueJson()]);
    await client.fetchInProgress();
    expect(calls[0]).toContain("--label");
    expect(calls[0]).toContain("status:in-progress");
    expect(calls[0]).toContain("--state");
    expect(calls[0]).toContain("open");
  });

  test("fetchReview filters by review label", async () => {
    const { client, calls } = makeProvider([issueJson()]);
    await client.fetchReview();
    expect(calls[0]).toContain("ralphy:review");
  });

  test("fetchDoneCandidates lists closed issues", async () => {
    const { client, calls } = makeProvider([issueJson({ state: "CLOSED" })]);
    const done = await client.fetchDoneCandidates();
    expect(calls[0]).toContain("--state");
    expect(calls[0]).toContain("closed");
    expect(done[0]?.state).toEqual({ name: "Closed", type: "completed" });
  });
});

describe("indicator side effects build correct gh argv", () => {
  const issue = mapGithubIssue({ number: 9, state: "OPEN" });

  test("applyIndicator(in-progress) issues issue edit --add-label", async () => {
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "status:in-progress" });
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "edit",
      "9",
      "--add-label",
      "status:in-progress",
      "--repo",
      "acme/widgets",
    ]);
  });

  test("applyIndicator(done) issues issue close", async () => {
    const { client, calls } = makeProvider();
    await client.applyIndicator(issue, { type: "label", value: "status:done" });
    expect(calls[0]).toEqual(["gh", "issue", "close", "9", "--repo", "acme/widgets"]);
  });

  test("removeIndicator issues issue edit --remove-label", async () => {
    const { client, calls } = makeProvider();
    await client.removeIndicator(issue, { type: "label", value: "ralphy:review" });
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "edit",
      "9",
      "--remove-label",
      "ralphy:review",
      "--repo",
      "acme/widgets",
    ]);
  });

  test("postComment issues issue comment --body", async () => {
    const { client, calls } = makeProvider();
    await client.postComment(issue, "hello world");
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "comment",
      "9",
      "--body",
      "hello world",
      "--repo",
      "acme/widgets",
    ]);
  });
});

describe("fetchComments and fetchMentions", () => {
  test("fetchComments parses gh issue view comments", async () => {
    const { client, calls } = makeProvider([
      JSON.stringify({ comments: [{ body: "first" }, { body: "second" }] }),
    ]);
    const bodies = (await client.fetchComments("9")).map((c) => c.body);
    expect(calls[0]).toEqual([
      "gh",
      "issue",
      "view",
      "9",
      "--json",
      "comments",
      "--repo",
      "acme/widgets",
    ]);
    expect(bodies).toEqual(["first", "second"]);
  });

  test("fetchMentions is a deferred stub returning []", async () => {
    const { client, calls } = makeProvider();
    expect(await client.fetchMentions()).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
