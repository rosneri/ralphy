import { describe, expect, test } from "bun:test";
import { hasMentionTrigger, buildMentionAckComment } from "../detections/mention";

describe("hasMentionTrigger", () => {
  test("non-Ralph comment contains phrase → true", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "Please ralph go now", isRalph: false }],
        triggerPhrase: "ralph go",
      }),
    ).toBe(true);
  });

  test("Ralph-authored comment is skipped → false", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "🤖 ralph go", isRalph: true }],
        triggerPhrase: "ralph go",
      }),
    ).toBe(false);
  });

  test("no comments → false", () => {
    expect(
      hasMentionTrigger({
        comments: [],
        triggerPhrase: "ralph go",
      }),
    ).toBe(false);
  });

  test("case-insensitive match → true", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "RALPH GO right now", isRalph: false }],
        triggerPhrase: "ralph go",
      }),
    ).toBe(true);
  });

  test("empty triggerPhrase matches any non-Ralph comment → true", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "anything at all", isRalph: false }],
        triggerPhrase: "",
      }),
    ).toBe(true);
  });

  test("phrase present in multiple non-Ralph comments → true (first wins)", () => {
    expect(
      hasMentionTrigger({
        comments: [
          { body: "ralph go please", isRalph: false },
          { body: "also ralph go", isRalph: false },
        ],
        triggerPhrase: "ralph go",
      }),
    ).toBe(true);
  });

  test("only Ralph comment with phrase, no non-Ralph comments → false", () => {
    expect(
      hasMentionTrigger({
        comments: [
          { body: "🤖 ralph go", isRalph: true },
          { body: "unrelated comment", isRalph: false },
        ],
        triggerPhrase: "ralph go",
      }),
    ).toBe(false);
  });
});

describe("buildMentionAckComment", () => {
  test("leads with the unified title and a mention-ack marker", () => {
    const result = buildMentionAckComment("@ralphy please retry");
    expect(result.startsWith("🤖 Ralphy · picked up your mention")).toBe(true);
    expect(result).toContain("<!-- ralphy:v=1 type=mention-ack -->");
  });

  test("without author uses Acknowledged greeting", () => {
    const result = buildMentionAckComment("@ralphy please retry");
    expect(result).toContain("Acknowledged — picked up your mention");
    expect(result).toContain("> @ralphy please retry");
  });

  test("with author uses Got it greeting", () => {
    const result = buildMentionAckComment("@ralphy please retry", "alice");
    expect(result).toContain("Got it, alice — picked up your mention");
    expect(result).toContain("> @ralphy please retry");
  });

  test("single-line body within 200 chars has no ellipsis", () => {
    const result = buildMentionAckComment("short message");
    expect(result).not.toContain("…");
    expect(result).toContain("> short message");
  });

  test("multiline body only quotes first line", () => {
    const result = buildMentionAckComment("first line\nsecond line\nthird line");
    expect(result).toContain("> first line");
    expect(result).not.toContain("second line");
    expect(result).not.toContain("third line");
  });

  test("long body truncated to 200 chars with ellipsis", () => {
    const longLine = "a".repeat(250);
    const result = buildMentionAckComment(longLine);
    expect(result).toContain("…");
    const excerpt = result.split("> ")[1]!.split("\n")[0]!;
    expect(excerpt.replace("…", "")).toHaveLength(200);
  });

  test("body exactly 200 chars has no ellipsis", () => {
    const exactLine = "b".repeat(200);
    const result = buildMentionAckComment(exactLine);
    expect(result).not.toContain("…");
  });
});
