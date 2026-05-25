import { describe, expect, test } from "bun:test";
import {
  formatReviewRoundComment,
  postReviewRoundComment,
  type ReviewCommentDeps,
  type ReviewRoundCommentInput,
} from "../review-comment";

describe("formatReviewRoundComment", () => {
  test("formats findings → looping back", () => {
    const body = formatReviewRoundComment("my-change", {
      openFindings: 3,
      roundNumber: 1,
      capReached: false,
      findingsContent: null,
    });
    expect(body).toContain("🔎");
    expect(body).toContain("3 finding(s)");
    expect(body).toContain("looping back");
    expect(body).toContain("round 1");
    expect(body).toContain("my-change");
  });

  test("formats no findings → passed", () => {
    const body = formatReviewRoundComment("my-change", {
      openFindings: 0,
      roundNumber: 2,
      capReached: false,
      findingsContent: null,
    });
    expect(body).toContain("✅");
    expect(body).toContain("No findings");
    expect(body).toContain("Proceeding to done");
  });

  test("formats cap reached with open findings", () => {
    const findings = "## Open\n\n- [ ] Fix it\n";
    const body = formatReviewRoundComment("my-change", {
      openFindings: 1,
      roundNumber: 2,
      capReached: true,
      findingsContent: findings,
    });
    expect(body).toContain("⚠️");
    expect(body).toContain("Cap reached");
    expect(body).toContain("1 open finding(s)");
    expect(body).toContain("Fix it");
  });

  test("cap reached without findings content omits code block", () => {
    const body = formatReviewRoundComment("my-change", {
      openFindings: 2,
      roundNumber: 3,
      capReached: true,
      findingsContent: null,
    });
    expect(body).toContain("⚠️");
    expect(body).not.toContain("```");
  });
});

describe("postReviewRoundComment", () => {
  test("calls createIssueComment with formatted body", async () => {
    const calls: Array<{ apiKey: string; issueId: string; body: string }> = [];
    const deps: ReviewCommentDeps = {
      apiKey: "key-123",
      issueId: "issue-abc",
      changeName: "test-change",
      log: () => {},
      createIssueComment: async (apiKey, issueId, body) => {
        calls.push({ apiKey, issueId, body });
        return "comment-id-1";
      },
    };

    const input: ReviewRoundCommentInput = {
      openFindings: 2,
      roundNumber: 1,
      capReached: false,
      findingsContent: null,
    };

    await postReviewRoundComment(deps, input);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.apiKey).toBe("key-123");
    expect(calls[0]!.issueId).toBe("issue-abc");
    expect(calls[0]!.body).toContain("🔎");
    expect(calls[0]!.body).toContain("2 finding(s)");
  });

  test("logs success after posting", async () => {
    const logs: string[] = [];
    const deps: ReviewCommentDeps = {
      apiKey: "key",
      issueId: "issue",
      changeName: "c",
      log: (text) => logs.push(text),
      createIssueComment: async () => "id",
    };

    await postReviewRoundComment(deps, {
      openFindings: 0,
      roundNumber: 1,
      capReached: false,
      findingsContent: null,
    });

    expect(logs.some((l) => l.includes("round 1"))).toBe(true);
  });

  test("logs warning on failure without throwing", async () => {
    const logs: string[] = [];
    const deps: ReviewCommentDeps = {
      apiKey: "key",
      issueId: "issue",
      changeName: "c",
      log: (text) => logs.push(text),
      createIssueComment: async () => {
        throw new Error("Linear API error");
      },
    };

    await expect(
      postReviewRoundComment(deps, {
        openFindings: 1,
        roundNumber: 1,
        capReached: false,
        findingsContent: null,
      }),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("Linear API error"))).toBe(true);
  });
});
