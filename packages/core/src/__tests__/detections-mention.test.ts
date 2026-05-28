import { describe, expect, test } from "bun:test";
import { hasMentionTrigger } from "../detections/mention";

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
