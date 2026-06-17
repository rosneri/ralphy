#!/usr/bin/env bun
/**
 * Prompt-rule drift guard (RLF-264).
 *
 * `PROJECT_QUALITY_RULES` (packages/core/src/prompt/project-rules.ts) is injected
 * into every agent phase prompt as the project's non-negotiable engineering
 * rules. Those rules only stay honest if each one is anchored in a canonical,
 * enforced source — `CLAUDE.md` (the human/agent contract) or `.oxlintrc.json`
 * (the machine-enforced lint config). When a rule is added to the prompt but
 * never written down in either anchor, the prompt and the codebase's real
 * conventions have drifted apart.
 *
 * This guard parses the rule lines out of `PROJECT_QUALITY_RULES` and, for each,
 * requires a mapped keyword to appear verbatim in `CLAUDE.md` or `.oxlintrc.json`.
 * Two failure modes both exit non-zero with a clear message:
 *   - a prompt rule that this guard has no keyword mapping for (someone added a
 *     rule without anchoring it — extend RULE_KEYWORDS), and
 *   - a mapped keyword that no longer appears in either anchor (the docs drifted
 *     away from the prompt).
 *
 * Bun-native: reads every file with `Bun.file`. No node:fs.
 */

import { join } from "node:path";
import { PROJECT_QUALITY_RULES } from "../packages/core/src/prompt/project-rules";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Anchor documents a rule keyword may live in (relative to the repo root). */
export const ANCHOR_FILES = ["CLAUDE.md", ".oxlintrc.json"];

/**
 * Maps each prompt rule to (a) a stable substring that identifies its line in
 * `PROJECT_QUALITY_RULES` and (b) the keyword that must appear in an anchor file.
 * `ruleMatch` is matched case-sensitively as a substring of the rule line;
 * `keyword` is matched case-insensitively against the anchor contents.
 */
export interface RuleKeyword {
  ruleMatch: string;
  keyword: string;
}

export const RULE_KEYWORDS: RuleKeyword[] = [
  { ruleMatch: "Bun-native APIs", keyword: "Bun-native" },
  { ruleMatch: "no unsafe casts", keyword: "no-explicit-any" },
  { ruleMatch: "do not abbreviate", keyword: "abbreviate" },
  { ruleMatch: "XState machines", keyword: "XState" },
  { ruleMatch: "No re-exports", keyword: "re-export" },
  { ruleMatch: "One config pipeline", keyword: "args.x || cfg.y" },
  { ruleMatch: "Shared logic lives", keyword: "packages/" },
];

/** Split the joined rules constant into its individual bullet lines. */
export function parseRuleLines(rules: string): string[] {
  return rules
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface SyncProblem {
  rule: string;
  kind: "unmapped" | "missing-anchor";
  keyword?: string;
}

/**
 * Check every rule line against the keyword map and the anchor contents.
 * Returns one problem per rule that is either unmapped or whose keyword is
 * absent from all anchors. Pure: anchors are passed in as a single blob.
 */
export function findSyncProblems(rules: string, anchorBlob: string): SyncProblem[] {
  const haystack = anchorBlob.toLowerCase();
  const problems: SyncProblem[] = [];
  for (const rule of parseRuleLines(rules)) {
    const mapping = RULE_KEYWORDS.find((entry) => rule.includes(entry.ruleMatch));
    if (!mapping) {
      problems.push({ rule, kind: "unmapped" });
      continue;
    }
    if (!haystack.includes(mapping.keyword.toLowerCase())) {
      problems.push({ rule, kind: "missing-anchor", keyword: mapping.keyword });
    }
  }
  return problems;
}

async function readAnchors(root: string): Promise<string> {
  const parts: string[] = [];
  for (const rel of ANCHOR_FILES) {
    const file = Bun.file(join(root, rel));
    if (await file.exists()) parts.push(await file.text());
  }
  return parts.join("\n");
}

async function main(): Promise<void> {
  const anchorBlob = await readAnchors(REPO_ROOT);
  const problems = findSyncProblems(PROJECT_QUALITY_RULES, anchorBlob);

  if (problems.length === 0) {
    console.log(
      `✓ All ${parseRuleLines(PROJECT_QUALITY_RULES).length} prompt rules are anchored in ${ANCHOR_FILES.join(" / ")}`,
    );
    return;
  }

  console.error(`✘ ${problems.length} prompt rule(s) have drifted from their anchors:\n`);
  for (const problem of problems) {
    if (problem.kind === "unmapped") {
      console.error(`  ${problem.rule}`);
      console.error(
        "    → no keyword mapping in scripts/check-prompt-rule-sync.ts; add one (and anchor the\n" +
          "      rule in CLAUDE.md or .oxlintrc.json) so the guard can verify it.\n",
      );
    } else {
      console.error(`  ${problem.rule}`);
      console.error(
        `    → keyword "${problem.keyword}" is absent from ${ANCHOR_FILES.join(" / ")}; document the\n` +
          "      rule there so the prompt and the codebase's real conventions stay in sync.\n",
      );
    }
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
