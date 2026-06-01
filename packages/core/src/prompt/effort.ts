import type { State } from "@ralphy/types";

/**
 * Effort tier for a single ticket. Selects a tier-specific guidance block that
 * is layered onto the task-level meta-prompt so the agent right-sizes its
 * behavior per ticket instead of applying one global posture.
 */
export type Effort = "light" | "standard" | "heavy";

export interface DetectEffortOptions {
  /** Raw `tasks.md` content, when available, used to count unchecked tasks. */
  tasksContent?: string;
  /** When set to a concrete tier, short-circuits the heuristic. */
  override?: Effort;
}

/**
 * Keywords that nudge a ticket toward `heavy`. Each hit contributes
 * `HEAVY_WEIGHT` to the score (capped via {@link KEYWORD_HIT_CAP}). Matching is
 * substring on the lowercased prompt — deliberately simple and deterministic.
 */
export const HEAVY_KEYWORDS: readonly string[] = [
  "migrate",
  "refactor",
  "redesign",
  "re-architect",
  "architecture",
  "rewrite",
  "overhaul",
  "breaking change",
  "investigate",
  "spike",
  "cross-cutting",
  "end-to-end",
];

/** Keywords that nudge a ticket toward `light`. Each hit contributes `LIGHT_WEIGHT`. */
export const LIGHT_KEYWORDS: readonly string[] = [
  "typo",
  "rename",
  "bump",
  "tweak",
  "wording",
  "copy",
  "comment",
  "lint",
  "docs",
  "one-liner",
  "revert",
  "whitespace",
];

/** Per-hit score contributions. */
export const HEAVY_WEIGHT = 2;
export const LIGHT_WEIGHT = -2;

/** Maximum absolute contribution from keyword hits in either direction. */
export const KEYWORD_HIT_CAP = 4;

/** Prompt-length thresholds (characters). */
export const SHORT_PROMPT_CHARS = 120;
export const LONG_PROMPT_CHARS = 600;

/** Unchecked-task-count thresholds (only applied when tasksContent is present). */
export const FEW_TASKS = 2;
export const MANY_TASKS = 8;

/** Score thresholds that map onto tiers. */
export const LIGHT_THRESHOLD = -2;
export const HEAVY_THRESHOLD = 2;

/**
 * Count unchecked `- [ ]` checklist items in markdown content. Tolerant of
 * leading whitespace and either bullet marker (`-` or `*`).
 */
function countUnchecked(tasksContent: string): number {
  const matches = tasksContent.match(/^\s*[-*]\s+\[ \]/gm);
  return matches ? matches.length : 0;
}

/** Clamp a value into the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Classify a ticket into an {@link Effort} tier.
 *
 * Pure and deterministic: the same inputs always produce the same tier. Does no
 * I/O, never reads the clock or randomness, and never throws on empty or
 * oversized input. An explicit `options.override` always wins over the
 * heuristic.
 */
export function detectEffort(state: State, options: DetectEffortOptions = {}): Effort {
  if (options.override) return options.override;

  const prompt = (state.prompt ?? "").toLowerCase();

  let keywordScore = 0;
  for (const kw of HEAVY_KEYWORDS) {
    if (prompt.includes(kw)) keywordScore += HEAVY_WEIGHT;
  }
  for (const kw of LIGHT_KEYWORDS) {
    if (prompt.includes(kw)) keywordScore += LIGHT_WEIGHT;
  }
  keywordScore = clamp(keywordScore, -KEYWORD_HIT_CAP, KEYWORD_HIT_CAP);

  let score = keywordScore;

  // Prompt length: very short prompts (with no heavy signal) lean light; long,
  // detailed prompts lean heavy.
  const hasHeavyKeyword = keywordScore > 0;
  if (prompt.length > 0 && prompt.length < SHORT_PROMPT_CHARS && !hasHeavyKeyword) {
    score -= 1;
  } else if (prompt.length > LONG_PROMPT_CHARS) {
    score += 1;
  }

  // Task count (only when tasks.md content is available).
  if (options.tasksContent) {
    const unchecked = countUnchecked(options.tasksContent);
    if (unchecked > 0 && unchecked <= FEW_TASKS) {
      score -= 2;
    } else if (unchecked >= MANY_TASKS) {
      score += 2;
    }
  }

  if (score <= LIGHT_THRESHOLD) return "light";
  if (score >= HEAVY_THRESHOLD) return "heavy";
  return "standard";
}

/**
 * Tier-specific guidance blocks emitted under `### Effort Guidance`. The three
 * blocks are intentionally mutually distinct.
 */
export const EFFORT_GUIDANCE: Record<Effort, string> = {
  light: [
    "This ticket looks **light**. Make the smallest correct change.",
    "- Skip research/design ceremony — go straight to the fix",
    "- Avoid speculative abstraction; do not expand scope",
    "- Aim to finish in as few iterations as possible",
  ].join("\n"),
  standard: [
    "This ticket looks **standard**. Balance thoroughness with momentum.",
    "- Do enough investigation to be confident, but don't over-engineer",
    "- Keep changes focused on the stated scope",
    "- Verify with the project's lint and test gates before finishing",
  ].join("\n"),
  heavy: [
    "This ticket looks **heavy**. Invest up front before changing code.",
    "- Research the affected areas and write a real design",
    "- Break the work into small, independently-verifiable tasks",
    "- Watch for cross-cutting impact and regressions as you go",
  ].join("\n"),
};

/**
 * Normalize a config-level effort selection (`"auto" | Effort`) into a
 * {@link DetectEffortOptions.override}. `"auto"` means "run the heuristic" and
 * maps to `undefined`; any concrete tier is passed through as the override.
 */
export function resolveEffortOverride(value: "auto" | Effort | undefined): Effort | undefined {
  if (value === undefined || value === "auto") return undefined;
  return value;
}
