import { describe, expect, test } from "bun:test";
import { createGithubMentionScanner } from "../agent/wire/mention-scan";
import { buildMentionAckComment } from "@ralphy/core/detections";
import type { CmdRunner } from "../agent/pr";
import type { TrackedIssue } from "@ralphy/tracker";

const REPO = "acme/widgets";

function issue(number: number): TrackedIssue {
  return {
    id: String(number),
    identifier: `issue-${number}`,
    title: `Issue ${number}`,
    description: null,
    url: `https://github.com/${REPO}/issues/${number}`,
    state: { name: "Open", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

interface GhComment {
  id: number;
  body: string;
  createdAt: string;
  author?: string;
  url: string;
}

/** Scripted `gh` runner: serves issue-comments per issue number, records every
 *  invocation, and lets a single call fail (to assert fail-soft / idempotence). */
function makeRunner(
  commentsByIssue: Record<number, GhComment[]>,
  opts: { failReaction?: boolean } = {},
): { runner: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CmdRunner = {
    run: async (argv) => {
      calls.push(argv);
      const joined = argv.join(" ");
      // GET issue comments: `gh api repos/o/r/issues/N/comments --jq …`
      const get = /repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(argv[2] ?? "");
      if (argv[1] === "api" && argv[2]?.endsWith("/comments") && !joined.includes("-X POST")) {
        const n = Number(get?.[1]);
        return { stdout: JSON.stringify(commentsByIssue[n] ?? []), stderr: "" };
      }
      // POST reaction.
      if (argv.includes("-X") && argv.some((a) => a.endsWith("/reactions"))) {
        if (opts.failReaction) throw new Error("already exists");
        return { stdout: "", stderr: "" };
      }
      // POST ack comment.
      return { stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

function makeCfg(overrides: { postComments?: boolean; mentionTrigger?: boolean } = {}) {
  return {
    linear: {
      mentionTrigger: overrides.mentionTrigger ?? true,
      mentionHandle: "@ralphy",
      postComments: overrides.postComments ?? true,
    },
  };
}

function makeScanner(
  commentsByIssue: Record<number, GhComment[]>,
  candidates: TrackedIssue[],
  opts: { postComments?: boolean; failReaction?: boolean; mentionTrigger?: boolean } = {},
) {
  const { runner, calls } = makeRunner(
    commentsByIssue,
    opts.failReaction !== undefined ? { failReaction: opts.failReaction } : {},
  );
  const scan = createGithubMentionScanner({
    cfg: makeCfg(opts),
    cmdRunner: runner,
    projectRoot: "/tmp/repo",
    onLog: () => {},
    diag: () => {},
    listOpenIssues: async () => candidates,
    repo: async () => REPO,
  });
  return { scan, calls };
}

const postArgv = (calls: string[][]): string[][] => calls.filter((c) => c.includes("-X"));

describe("createGithubMentionScanner", () => {
  test("fresh @ralphy mention emits a github trigger, a 👀 reaction, and an ack marker", async () => {
    const { scan, calls } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy please take another look",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: `https://github.com/${REPO}/issues/7#issuecomment-100`,
          },
        ],
      },
      [issue(7)],
    );

    const out = await scan();
    expect(out).toHaveLength(1);
    expect(out[0]?.trigger.source).toBe("github");
    expect(out[0]?.trigger.body).toBe("@ralphy please take another look");

    // 👀 reaction posted to the triggering comment id.
    const reactionCall = calls.find((c) =>
      c.some((a) => a.endsWith("/issues/comments/100/reactions")),
    );
    expect(reactionCall).toBeDefined();
    expect(reactionCall?.join(" ")).toContain("content=eyes");

    // Hidden mention-ack marker posted as an issue comment.
    const ackCall = calls.find(
      (c) => c.some((a) => a.endsWith("/issues/7/comments")) && c.includes("-X"),
    );
    expect(ackCall).toBeDefined();
    expect(ackCall?.join(" ")).toContain("type=mention-ack");
  });

  test("comment without the handle is ignored", async () => {
    const { scan, calls } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "looks good, thanks",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
        ],
      },
      [issue(7)],
    );
    const out = await scan();
    expect(out).toHaveLength(0);
    expect(postArgv(calls)).toHaveLength(0);
  });

  test("postComments: false reacts but posts no ack marker", async () => {
    const { scan, calls } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy ping",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
        ],
      },
      [issue(7)],
      { postComments: false },
    );
    const out = await scan();
    expect(out).toHaveLength(1);
    const reactionCall = calls.find((c) => c.some((a) => a.endsWith("/reactions")));
    expect(reactionCall).toBeDefined();
    const ackCall = calls.find(
      (c) => c.some((a) => a.endsWith("/issues/7/comments")) && c.includes("-X"),
    );
    expect(ackCall).toBeUndefined();
  });

  test("an answered mention (followed by the ack marker) is not re-emitted", async () => {
    const { scan } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy please look",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
          {
            id: 101,
            body: buildMentionAckComment(),
            createdAt: "2026-02-01T00:01:00.000Z",
            author: "ralphy-bot",
            url: "u2",
          },
        ],
      },
      [issue(7)],
    );
    const out = await scan();
    expect(out).toHaveLength(0);
  });

  test("a Ralphy-authored comment containing the handle is skipped", async () => {
    const { scan } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "<!-- ralphy:v=1 type=mention-ack status=handled -->\n@ralphy on it",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "ralphy-bot",
            url: "u",
          },
        ],
      },
      [issue(7)],
    );
    const out = await scan();
    expect(out).toHaveLength(0);
  });

  test("a reaction 'already exists' error does not abort the emit", async () => {
    const { scan } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy ping",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
        ],
      },
      [issue(7)],
      { failReaction: true },
    );
    const out = await scan();
    expect(out).toHaveLength(1);
  });

  test("disabled mentionTrigger emits nothing and makes no calls", async () => {
    const { scan, calls } = makeScanner(
      { 7: [{ id: 100, body: "@ralphy ping", createdAt: "2026-02-01T00:00:00.000Z", url: "u" }] },
      [issue(7)],
      { mentionTrigger: false },
    );
    const out = await scan();
    expect(out).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("the scan never invokes the GitHub Search-API", async () => {
    const { scan, calls } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy look",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
        ],
      },
      [issue(7)],
    );
    await scan();
    for (const c of calls) {
      const joined = c.join(" ");
      expect(joined).not.toContain("search/issues");
      expect(joined.startsWith("gh search")).toBe(false);
    }
  });

  test("embeds the fetched comments on the candidate issue", async () => {
    const candidate = issue(7);
    const { scan } = makeScanner(
      {
        7: [
          {
            id: 100,
            body: "@ralphy look",
            createdAt: "2026-02-01T00:00:00.000Z",
            author: "alice",
            url: "u",
          },
        ],
      },
      [candidate],
    );
    await scan();
    expect(candidate.comments).toHaveLength(1);
    expect(candidate.comments?.[0]?.id).toBe("100");
    expect(candidate.comments?.[0]?.user?.name).toBe("alice");
  });
});
