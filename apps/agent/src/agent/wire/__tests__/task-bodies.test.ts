import { describe, expect, it } from "bun:test";
import { containsHandle, isRalphComment } from "../task-bodies";

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
