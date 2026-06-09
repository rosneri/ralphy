import { describe, expect, it } from "bun:test";
import {
  containsHandle,
  findLastMentionAckISO,
  findLastRalphPickupISO,
  isRalphComment,
} from "../task-bodies";
import { buildMentionAckComment } from "@ralphy/core/detections";

describe("isRalphComment", () => {
  it("matches the 📋 Ralphy plan ready gate comment", () => {
    expect(
      isRalphComment(
        "📋 Ralphy plan ready for `rlf-87` — review proposal.md / design.md / tasks.md",
      ),
    ).toBe(true);
  });

  it("matches each of the existing ralph comment prefixes", () => {
    for (const prefix of ["🤖", "🔄", "✅", "✗", "⚠", "🔁"]) {
      expect(isRalphComment(`${prefix} Ralph did the thing`)).toBe(true);
    }
  });

  it("does not match an unrelated comment", () => {
    expect(isRalphComment("hey @ralphy please look at this")).toBe(false);
  });
});

describe("findLastMentionAckISO — re-ack dedup (BAN-467)", () => {
  it("returns the newest mention-ack timestamp, gating the original mention", () => {
    const mentionAt = "2026-06-08T11:26:00.000Z";
    const ackAt = "2026-06-08T11:58:00.000Z";
    const comments = [
      { body: "@ralphy-read revise: use the toggle", createdAt: mentionAt },
      {
        body: buildMentionAckComment(),
        createdAt: ackAt,
      },
    ];
    const watermark = findLastMentionAckISO(comments);
    expect(watermark).toBe(ackAt);
    // The mention predates the ack, so the scan's `createdAt <= watermark`
    // gate skips it on the next poll — no re-ack.
    expect(mentionAt <= watermark!).toBe(true);
  });

  it("recognizes the legacy 👀 ack lead and ignores non-acks", () => {
    expect(
      findLastMentionAckISO([
        {
          body: "👀 Got it, Neriya! I've picked up your mention.",
          createdAt: "2026-06-08T12:00:00.000Z",
        },
      ]),
    ).toBe("2026-06-08T12:00:00.000Z");
    expect(findLastMentionAckISO([{ body: "just a human note", createdAt: "x" }])).toBeNull();
  });

  it("findLastRalphPickupISO stays scoped to review-pickup, not mention-acks", () => {
    const comments = [
      {
        body: buildMentionAckComment(),
        createdAt: "2026-06-08T12:00:00.000Z",
      },
    ];
    expect(findLastRalphPickupISO(comments)).toBeNull();
  });
});

describe("containsHandle", () => {
  it("returns true for a bare mention", () => {
    expect(containsHandle("hey @ralphy can you take a look?", "@ralphy")).toBe(true);
  });

  it("returns false when the mention is only inside an inline code span", () => {
    expect(containsHandle("call it like `@ralphy` in the docs", "@ralphy")).toBe(false);
  });

  it("returns false when the mention is only inside a fenced code block", () => {
    const body = ["before", "```", "post a comment mentioning @ralphy here", "```", "after"].join(
      "\n",
    );
    expect(containsHandle(body, "@ralphy")).toBe(false);
  });
});
