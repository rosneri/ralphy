import { z } from "zod";

/**
 * Default meta-only globs used by the pre-PR "substantive diff" guard.
 * If every file changed against the base branch matches one of these,
 * the loop refuses to open the PR (the actual implementation was lost)
 * and re-runs the worker with a fix task instead.
 */
export const DEFAULT_META_ONLY_FILES = [
  "openspec/**",
  ".ralph/**",
  "**/agent-tasks.md",
  "**/tasks.md",
  "**/MANUAL_TESTING*.md",
];

export const BoundariesSchema = z
  .object({
    never_touch: z.array(z.string()).default([]),
    meta_only_files: z.array(z.string()).default(DEFAULT_META_ONLY_FILES),
  })
  .strict()
  .default({ never_touch: [], meta_only_files: DEFAULT_META_ONLY_FILES });
