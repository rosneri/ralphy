import { describe, expect, test } from "bun:test";
import { stripCommentsAndStrings, findViolations } from "../check-config-merge";

// Regression: the line-comment branch of stripCommentsAndStrings looped without
// advancing `i`, so the first `//` in any source file spun forever pushing
// blanks into the output array until the process exhausted memory (OOM-killing
// the whole agent fleet via its shared cgroup). The block-comment and string
// branches advance `i`; the line-comment branch must too.
describe("stripCommentsAndStrings — line comments terminate (OOM regression)", () => {
  test("blanks a line comment, preserving length and newlines", () => {
    const input = "a // c\nb";
    const out = stripCommentsAndStrings(input);
    expect(out.length).toBe(input.length); // exact length preserved → byte offsets stay valid
    expect(out).toBe("a     \nb"); // comment (incl. the //) blanked, newline kept
  });

  test("a comment at end-of-file (no trailing newline) terminates", () => {
    const input = "x // trailing";
    const out = stripCommentsAndStrings(input);
    expect(out.length).toBe(input.length);
    expect(out).toBe("x            ");
  });

  test("multiple line comments across lines all terminate and blank", () => {
    const input = "const a = 1; // one\nconst b = 2; // two\n";
    const out = stripCommentsAndStrings(input);
    expect(out.length).toBe(input.length);
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
  });
});

describe("findViolations — comments don't mask or false-positive", () => {
  test("a banned merge in a comment is NOT flagged", () => {
    expect(findViolations("// args.x || cfg.y\n")).toEqual([]);
  });

  test("a real banned merge IS flagged even with comments present", () => {
    const src = "// a note\nconst team = args.team || cfg.linear.team;\n";
    const violations = findViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.root).toBe("cfg");
  });
});
