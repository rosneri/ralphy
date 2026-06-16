import { describe, expect, test } from "bun:test";
import { PROJECT_QUALITY_RULES } from "../../packages/core/src/prompt/project-rules";
import { RULE_KEYWORDS, findSyncProblems, parseRuleLines } from "../check-prompt-rule-sync";

describe("parseRuleLines", () => {
  test("splits the joined constant into trimmed, non-empty bullets", () => {
    expect(parseRuleLines("- a\n- b\n\n  - c  ")).toEqual(["- a", "- b", "- c"]);
  });
});

describe("findSyncProblems (the matcher)", () => {
  const fullAnchor = RULE_KEYWORDS.map((entry) => entry.keyword).join(" ");

  test("clean when every mapped keyword is present in the anchors", () => {
    expect(findSyncProblems(PROJECT_QUALITY_RULES, fullAnchor)).toEqual([]);
  });

  test("flags a mapped rule whose keyword is missing from the anchors", () => {
    // Drop one keyword from the anchor blob → that rule is reported missing.
    const dropped = RULE_KEYWORDS[0]!;
    const partial = RULE_KEYWORDS.slice(1)
      .map((entry) => entry.keyword)
      .join(" ");
    const problems = findSyncProblems(PROJECT_QUALITY_RULES, partial);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe("missing-anchor");
    expect(problems[0]!.keyword).toBe(dropped.keyword);
  });

  test("flags a prompt rule that has no keyword mapping", () => {
    const rulesWithExtra = `${PROJECT_QUALITY_RULES}\n- Some brand-new rule nobody anchored yet`;
    const problems = findSyncProblems(rulesWithExtra, fullAnchor);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe("unmapped");
  });

  test("keyword matching is case-insensitive against the anchors", () => {
    expect(findSyncProblems(PROJECT_QUALITY_RULES, fullAnchor.toUpperCase())).toEqual([]);
  });
});

describe("RULE_KEYWORDS covers every live prompt rule", () => {
  test("each PROJECT_QUALITY_RULES line maps to exactly one keyword entry", () => {
    for (const rule of parseRuleLines(PROJECT_QUALITY_RULES)) {
      const matches = RULE_KEYWORDS.filter((entry) => rule.includes(entry.ruleMatch));
      expect(matches).toHaveLength(1);
    }
  });
});
