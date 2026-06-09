import { describe, expect, test } from "bun:test";
import { hasMentionTrigger, buildMentionAckComment } from "../detections/mention";
import { isMentionAckComment, isRalphyComment } from "@ralphy/comms";

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
  test("is only the hidden mention-ack marker — no visible prose", () => {
    const result = buildMentionAckComment();
    // The whole comment is the HTML-comment marker (invisible in the tracker
    // UI); the visible acknowledgment is the 👀 reaction the scan adds.
    expect(result).toBe("<!-- ralphy:v=1 type=mention-ack status=handled -->");
    expect(result.startsWith("🤖 Ralphy")).toBe(false);
    expect(result).not.toContain("picked up your mention");
  });

  test("is recognised as a mention-ack watermark and as a Ralphy comment", () => {
    const result = buildMentionAckComment();
    expect(isMentionAckComment(result)).toBe(true);
    expect(isRalphyComment(result)).toBe(true);
  });
});
