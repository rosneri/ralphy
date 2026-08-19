/**
 * The Linear marker vocabulary: the discriminated `{type, value}` union that
 * lifecycle indicators and the global ticket filter are both written in, plus
 * the `!value` negation shorthand shared by every negatable kind.
 *
 * Its own module rather than part of `schema.ts` (which composes it into
 * `WorkflowConfigSchema`) or of `linear/linear-filter.ts` (which resolves it):
 * folding it into the resolver would drag that whole module into the import
 * graph of every schema consumer.
 */
import { z } from "zod";

// `value: "!foo"` is shorthand for a negated marker (`{ value: "foo", negate:
// true }`) on the `label` / `status` / `project` kinds, which is what a config
// author types as `!something`. Normalized here so the rest of the codebase only
// ever sees an explicit `negate` flag. An explicit `negate` always wins (no
// double-strip). Non-negatable kinds (assignee/attachment/comment) keep a literal
// leading "!".
function normalizeNegationShorthand(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  const t = obj["type"];
  const negatable = t === "label" || t === "status" || t === "project";
  if (!negatable || obj["negate"] !== undefined) return v;
  const value = obj["value"];
  if (typeof value === "string" && value.startsWith("!")) {
    return { ...obj, value: value.slice(1), negate: true };
  }
  return v;
}

// Discriminated marker union: `group` is only valid on the `label` variant
// (resolves nested labels as `${group}:${value}` — see Marker type docs).
// `negate` (getX only) is valid on `label` / `status` / `project`. Variants are
// `.strict()` so a stray key (e.g. `group` on a non-label, or `negate` on an
// attachment) raises a config error instead of being silently dropped.
export const MarkerSchema = z.preprocess(
  normalizeNegationShorthand,
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("label"),
      value: z.string().min(1),
      group: z.string().min(1).optional(),
      negate: z.boolean().optional(),
    }),
    z
      .object({
        type: z.literal("status"),
        value: z.string().min(1),
        negate: z.boolean().optional(),
      })
      .strict(),
    z.object({ type: z.literal("attachment"), value: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("project"),
        value: z.string().min(1),
        negate: z.boolean().optional(),
      })
      .strict(),
    z.object({ type: z.literal("comment"), value: z.string().min(1) }).strict(),
  ]),
);

/**
 * The global `linear.filter` marker list (RLF-206 → marker form). Restricted to
 * `label`, `project`, and `assignee` clauses — deliberately narrower than
 * {@link MarkerSchema} (no status/comment, and `assignee` exists ONLY here, never
 * in a lifecycle indicator). All clauses are ANDed; at most one `assignee` and at
 * most one positive `project` are allowed. `label` / `project` accept `negate`
 * (and the `!value` shorthand) to mean "must NOT carry / must NOT be in".
 */
const FilterMarkerSchema = z.preprocess(
  normalizeNegationShorthand,
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("label"),
        value: z.string().min(1),
        negate: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("project"),
        value: z.string().min(1),
        negate: z.boolean().optional(),
      })
      .strict(),
    z.object({ type: z.literal("assignee"), value: z.string().min(1) }).strict(),
  ]),
);

export const LinearFilterSchema = z
  .array(FilterMarkerSchema)
  .superRefine((markers, ctx) => {
    const assigneeCount = markers.filter((m) => m.type === "assignee").length;
    if (assigneeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `linear.filter allows at most one "assignee" clause, found ${assigneeCount}.`,
      });
    }
    const positiveProjects = markers.filter((m) => m.type === "project" && !m.negate).length;
    if (positiveProjects > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `linear.filter allows at most one positive "project" clause, found ${positiveProjects}.`,
      });
    }
  })
  .default([{ type: "assignee", value: "me" }]);
