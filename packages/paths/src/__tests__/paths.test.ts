import { describe, expect, test } from "bun:test";
import { worktreesDir } from "../paths";

describe("worktreesDir", () => {
  test("returns a homedir-anchored path", () => {
    const dir = worktreesDir("/tmp/foo");
    expect(dir).toContain(".ralph");
    expect(dir).toContain("worktrees");
    expect(dir).toContain("foo");
  });
});
