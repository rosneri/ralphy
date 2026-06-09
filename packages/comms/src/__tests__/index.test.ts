import { describe, expect, it } from "bun:test";
import {
  RALPHY_BRAND,
  RALPHY_TITLE_PREFIX,
  buildRalphyComment,
  buildRalphyMarker,
  findStickyComment,
  isMentionAckComment,
  isPickupComment,
  isRalphyComment,
  isStartedComment,
  parseRalphyMarker,
} from "../index";

describe("buildRalphyComment", () => {
  it("leads with the fixed unified title and ends with a hidden marker", () => {
    const comment = buildRalphyComment({
      type: "review-pickup",
      action: "picked up review comments",
      body: "Tracking change: `ban-467`",
      fields: { change: "ban-467" },
    });
    const lines = comment.split("\n");
    expect(lines[0]).toBe(`${RALPHY_TITLE_PREFIX}picked up review comments`);
    expect(lines[0]!.startsWith(RALPHY_BRAND)).toBe(true);
    expect(lines.at(-1)).toBe("<!-- ralphy:v=1 type=review-pickup change=ban-467 -->");
    expect(comment).toContain("Tracking change: `ban-467`");
  });

  it("omits the body block when no body is given", () => {
    const comment = buildRalphyComment({ type: "started", action: "started working" });
    expect(comment).toBe("🤖 Ralphy · started working\n\n<!-- ralphy:v=1 type=started -->");
  });
});

describe("marker round-trip", () => {
  it("parses type and fields back out", () => {
    const marker = buildRalphyMarker("exited", { change: "ban-467", code: 143 });
    const parsed = parseRalphyMarker(`some text\n${marker}`);
    expect(parsed).toEqual({
      version: 1,
      type: "exited",
      fields: { change: "ban-467", code: "143" },
    });
  });

  it("drops empty field values", () => {
    expect(buildRalphyMarker("progress", { change: "", iter: undefined })).toBe(
      "<!-- ralphy:v=1 type=progress -->",
    );
  });

  it("sanitizes values that would break the marker host", () => {
    const marker = buildRalphyMarker("promoted", { note: "a --> b c" });
    expect(marker).toBe("<!-- ralphy:v=1 type=promoted note=a_-_b_c -->");
    expect(parseRalphyMarker(marker)?.fields.note).toBe("a_-_b_c");
  });

  it("returns null when there is no marker", () => {
    expect(parseRalphyMarker("just a human comment")).toBeNull();
  });

  it("skips bare ralphy sentinels and finds the real typed marker", () => {
    // The tasks comment carries a structural `tasks:start` sentinel BEFORE its
    // typed marker — first-match must not stop on the untyped sentinel.
    const body =
      "🤖 Ralphy · task progress\n<!-- ralphy:tasks:start -->\n…\n<!-- ralphy:v=1 type=tasks change=x -->";
    expect(parseRalphyMarker(body)?.type).toBe("tasks");
  });
});

describe("isRalphyComment", () => {
  it("recognizes the unified title", () => {
    expect(isRalphyComment("🤖 Ralphy · started working\n\n<!-- ralphy:v=1 type=started -->")).toBe(
      true,
    );
  });

  it("recognizes a marker even without the title prefix", () => {
    expect(isRalphyComment("custom body\n<!-- ralphy:v=1 type=plan -->")).toBe(true);
  });

  it("recognizes legacy emoji-led comments", () => {
    expect(isRalphyComment("🤖 Ralph started working on this issue.")).toBe(true);
    expect(isRalphyComment("🔁 Ralph picked up new review comments.")).toBe(true);
    expect(isRalphyComment("👀 Got it, Neriya! I've picked up your mention.")).toBe(true);
    // ℹ️ was previously unmatched — the no-op completion comment.
    expect(isRalphyComment("ℹ️ Ralph completed all tasks but produced no code changes.")).toBe(
      true,
    );
  });

  it("does not match a human comment", () => {
    expect(isRalphyComment("@ralphy-read revise: use the feature toggle")).toBe(false);
  });
});

describe("isPickupComment / isStartedComment", () => {
  it("matches pickup by marker and by legacy lead", () => {
    expect(
      isPickupComment(buildRalphyComment({ type: "review-pickup", action: "picked up" })),
    ).toBe(true);
    expect(isPickupComment("🔁 Ralph picked up new review comments.")).toBe(true);
    expect(isPickupComment("🤖 Ralphy · started working\n<!-- ralphy:v=1 type=started -->")).toBe(
      false,
    );
  });

  it("matches started by marker and by legacy lead", () => {
    expect(
      isStartedComment(buildRalphyComment({ type: "started", action: "started working" })),
    ).toBe(true);
    expect(isStartedComment("🤖 Ralph started working on this issue.")).toBe(true);
    expect(isStartedComment("🔄 Ralph progress update")).toBe(false);
  });

  it("matches mention-ack by marker and by legacy lead", () => {
    expect(
      isMentionAckComment(buildRalphyComment({ type: "mention-ack", action: "picked up" })),
    ).toBe(true);
    expect(isMentionAckComment("👀 Got it, Neriya! I've picked up your mention.")).toBe(true);
    expect(isMentionAckComment("👀 Acknowledged! I've picked up your mention.")).toBe(true);
    expect(
      isMentionAckComment("🤖 Ralphy · started working\n<!-- ralphy:v=1 type=started -->"),
    ).toBe(false);
  });
});

describe("findStickyComment", () => {
  it("returns the comment whose marker type matches", () => {
    const target = buildRalphyComment({ type: "attachment", action: "design ready" });
    const comments = [
      { id: "a", body: buildRalphyComment({ type: "started", action: "started working" }) },
      { id: "b", body: target },
      { id: "c", body: "👋 a plain human comment" },
    ];
    expect(findStickyComment(comments, "attachment")).toEqual({ id: "b", body: target });
  });

  it("returns null when no comment carries a matching marker", () => {
    const comments = [
      { id: "a", body: buildRalphyComment({ type: "started", action: "started working" }) },
      { id: "b", body: "👋 a plain human comment mentioning ralphy: but no marker" },
    ];
    expect(findStickyComment(comments, "attachment")).toBeNull();
  });

  it("returns the first comment in list order when duplicated", () => {
    const first = buildRalphyComment({ type: "attachment", action: "first" });
    const second = buildRalphyComment({ type: "attachment", action: "second" });
    const comments = [
      { id: "1", body: first },
      { id: "2", body: second },
    ];
    expect(findStickyComment(comments, "attachment")).toEqual({ id: "1", body: first });
  });

  it("round-trips an attachment marker through build/parse", () => {
    const body = buildRalphyComment({
      type: "attachment",
      action: "design ready",
      fields: { change: "rlf-237" },
    });
    const parsed = parseRalphyMarker(body);
    expect(parsed?.type).toBe("attachment");
    expect(parsed?.fields.change).toBe("rlf-237");
  });
});
