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

  test("marker-bearing Ralphy comment with isRalph false is skipped → false", () => {
    expect(
      hasMentionTrigger({
        comments: [
          {
            body: "Acknowledged — ralph go\n\n<!-- ralphy:v=1 type=mention-ack -->",
            isRalph: false,
          },
        ],
        triggerPhrase: "ralph go",
      }),
    ).toBe(false);
  });

  test("titled Ralphy comment with isRalph false is skipped → false", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "🤖 Ralphy · picked up your mention — ralph go", isRalph: false }],
        triggerPhrase: "ralph go",
      }),
    ).toBe(false);
  });

  test("genuine human comment with phrase and no marker → true", () => {
    expect(
      hasMentionTrigger({
        comments: [{ body: "hey please ralph go now", isRalph: false }],
        triggerPhrase: "ralph go",
      }),
    ).toBe(true);
  });
});

describe("buildMentionAckComment", () => {
  test("leads with the unified title and a mention-ack marker", () => {
    const result = buildMentionAckComment("@ralphy please retry");
    expect(result.startsWith("🤖 Ralphy · picked up your mention")).toBe(true);
    expect(result).toContain("<!-- ralphy:v=1 type=mention-ack -->");
  });

  test("without author uses Acknowledged greeting and no quote", () => {
    const result = buildMentionAckComment("@ralphy please retry");
    expect(result).toContain("Acknowledged — picked up your mention");
    expect(result).not.toContain("@ralphy please retry");
  });

  test("with author uses Got it greeting and no quote", () => {
    const result = buildMentionAckComment("@ralphy please retry", "alice");
    expect(result).toContain("Got it, alice — picked up your mention");
    expect(result).not.toContain("@ralphy please retry");
  });

  test("does not contain any blockquote line", () => {
    const result = buildMentionAckComment("@ralphy please retry", "alice");
    expect(result.split("\n").some((line) => line.startsWith(">"))).toBe(false);
  });

  test("multiline body is not echoed at all", () => {
    const result = buildMentionAckComment("first line\nsecond line\nthird line");
    expect(result).not.toContain("first line");
    expect(result).not.toContain("second line");
    expect(result).not.toContain("third line");
  });

  test("long body is neither echoed nor truncated with ellipsis", () => {
    const longLine = "a".repeat(250);
    const result = buildMentionAckComment(longLine);
    expect(result).not.toContain("a".repeat(20));
    expect(result).not.toContain("…");
  });
});
