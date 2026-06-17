import { describe, expect, test } from "bun:test";
import type { TrackedIssue } from "@ralphy/tracker";
import { branchForChange } from "../../../agent/worktree";
import { githubIdentifierStrategy, linearIdentifierStrategy } from "../github/identifier-strategy";

describe("githubIdentifierStrategy", () => {
  test("scopeKey is owner/repo when present, else empty", () => {
    expect(
      githubIdentifierStrategy.scopeKey({ number: 1, title: "x", owner: "o", repo: "r" }),
    ).toBe("o/r");
    expect(githubIdentifierStrategy.scopeKey({ number: 1, title: "x" })).toBe("");
  });
  test("changeName / branchName produce the gh-<number>-<slug> shape", () => {
    const issue = { number: 9, title: "Add dark mode" };
    expect(githubIdentifierStrategy.changeName(issue)).toBe("gh-9-add-dark-mode");
    expect(githubIdentifierStrategy.branchName(issue)).toBe(branchForChange("gh-9-add-dark-mode"));
  });
});

describe("linearIdentifierStrategy", () => {
  const issue = { identifier: "RLF-232", title: "Add dark mode" } as TrackedIssue;
  test("scopeKey is the team key (identifier prefix)", () => {
    expect(linearIdentifierStrategy.scopeKey(issue)).toBe("RLF");
  });
  test("changeName lowercases the identifier and slugs the title", () => {
    expect(linearIdentifierStrategy.changeName(issue)).toBe("rlf-232-add-dark-mode");
  });
  test("branchName wraps changeName via branchForChange", () => {
    expect(linearIdentifierStrategy.branchName(issue)).toBe(
      branchForChange(linearIdentifierStrategy.changeName(issue)),
    );
  });
});
