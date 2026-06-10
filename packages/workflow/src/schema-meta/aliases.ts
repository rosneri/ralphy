/**
 * Nested alias blocks (`agent.*`, `github.*`, `worktree.*`) that mirror flat
 * top-level WORKFLOW.md keys. Folding is presence-based: an alias value fills
 * its flat key only when the author did not write the flat key at all. An
 * explicitly written flat key always wins — even when it is set to the schema
 * default — so there are no default-equality sentinels anywhere in the fold.
 *
 * Two layers consume this table:
 *  - `parseWorkflow` folds the raw YAML object before Zod validation (which
 *    would otherwise bake defaults and destroy presence information).
 *  - `normalizeWorkflowMarkdown` folds the YAML document BEFORE its
 *    defaults-fill pass, so a backfilled default never shadows an alias value.
 */
export interface WorkflowAlias {
  /** Flat top-level WORKFLOW.md key. */
  flat: string;
  /** Path of the nested alias (`[block, key]`). */
  alias: [string, string];
}

export const WORKFLOW_TOP_LEVEL_ALIASES: readonly WorkflowAlias[] = [
  { flat: "prBaseBranch", alias: ["github", "base_branch"] },
  { flat: "autoMergeStrategy", alias: ["github", "auto_merge_strategy"] },
  { flat: "prLabels", alias: ["github", "pr_labels"] },
  { flat: "engine", alias: ["agent", "engine"] },
  { flat: "model", alias: ["agent", "model"] },
  { flat: "concurrency", alias: ["agent", "concurrency"] },
  { flat: "maxIterationsPerTask", alias: ["agent", "max_iterations_per_task"] },
  { flat: "maxConsecutiveFailuresPerTask", alias: ["agent", "max_consecutive_failures"] },
  { flat: "useWorktree", alias: ["worktree", "enabled"] },
  { flat: "cleanupWorktreeOnSuccess", alias: ["worktree", "cleanup_on_success"] },
  { flat: "setupScript", alias: ["worktree", "setup_script"] },
];

/**
 * Fold alias values onto their flat keys in a raw (pre-Zod) frontmatter
 * object, in place. Presence-based: the flat key wins whenever the author
 * wrote it; the alias fills it only when absent.
 */
export function foldAliasesRaw(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const obj = raw as Record<string, unknown>;
  for (const { flat, alias } of WORKFLOW_TOP_LEVEL_ALIASES) {
    if (obj[flat] !== undefined) continue;
    const block = obj[alias[0]];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const value = (block as Record<string, unknown>)[alias[1]];
    if (value !== undefined) obj[flat] = value;
  }
}
