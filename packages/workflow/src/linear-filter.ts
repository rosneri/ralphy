/**
 * Resolver for the global `linear.filter` marker list (RLF-206 → marker form).
 *
 * `linear.filter` is a high-level "grab all" scope ANDed into every Linear
 * ticket fetch (and, transitively, the GitHub PR searches rooted at those
 * tickets). It is a marker list restricted to two kinds — `assignee` and
 * `label`:
 *
 *   - type: assignee   # value ∈ { me, any, unassigned, <email>, <user-id> }
 *   - type: label      # an issue-label name the ticket MUST carry
 *
 * The resolver folds those clauses into the fields the query layer already
 * understands: the single assignee constraint (`assignee`/`anyAssignee`) and
 * the must-have label list (`requireAllLabels`). Multiple `label` clauses are
 * ANDed (the ticket must carry every one). At most one `assignee` clause is
 * allowed — two would be contradictory under an equality constraint.
 *
 *   | assignee value      | resolved                    |
 *   |---------------------|-----------------------------|
 *   | me                  | { assignee: "me" }          |
 *   | any                 | { anyAssignee: true }       |
 *   | unassigned / (blank)| { assignee: "unassigned" }  |
 *   | <email>             | { assignee: "<email>" }     |
 *   | <user-id>           | { assignee: "<id>" }        |
 *
 * When the filter omits an `assignee` clause, `assignee`/`anyAssignee` are left
 * unset and the per-query default applies.
 */

import { z } from "zod";
import type { LinearFilter, LinearFilterScope, ResolvedLinearFilter } from "@ralphy/types";

/**
 * Project the non-assignee half of a {@link ResolvedLinearFilter} into a
 * {@link LinearFilterScope} — the bundle threaded down to every query spec.
 * Optional fields are copied only when present so a spread into a spec never
 * sets a key to `undefined`.
 */
export function linearFilterScope(resolved: ResolvedLinearFilter): LinearFilterScope {
  const scope: LinearFilterScope = { requireAllLabels: resolved.requireAllLabels };
  if (resolved.excludeLabels) scope.excludeLabels = resolved.excludeLabels;
  if (resolved.requireProject) scope.requireProject = resolved.requireProject;
  if (resolved.excludeProjects) scope.excludeProjects = resolved.excludeProjects;
  return scope;
}

/**
 * Resolve the global `linear.filter` marker list into the assignee constraint
 * and the must-have label set. Throws when more than one `assignee` clause is
 * present so a contradictory filter fails loudly at config-load time.
 */
export function resolveLinearFilter(filter: LinearFilter): ResolvedLinearFilter {
  const assigneeClauses = filter.filter((marker) => marker.type === "assignee");
  if (assigneeClauses.length > 1) {
    throw new Error(
      `Invalid linear.filter: at most one "assignee" clause is allowed, found ${assigneeClauses.length}.`,
    );
  }

  // Partition label / project clauses by negation. Positive labels/projects are
  // must-have / must-be-in; negated ones are must-not. Deduped, order-preserving.
  const requireAllLabels = collectDeduped(filter, "label", false);
  const excludeLabels = collectDeduped(filter, "label", true);
  const requireProjects = collectDeduped(filter, "project", false);
  const excludeProjects = collectDeduped(filter, "project", true);

  if (requireProjects.length > 1) {
    throw new Error(
      `Invalid linear.filter: at most one positive "project" clause is allowed, found ${requireProjects.length}.`,
    );
  }

  // Build the optional fields additively so an empty filter still resolves to
  // exactly `{ requireAllLabels: [] }` (no spurious empty arrays).
  const optional: Partial<ResolvedLinearFilter> = {};
  if (excludeLabels.length > 0) optional.excludeLabels = excludeLabels;
  if (requireProjects[0] !== undefined) optional.requireProject = requireProjects[0];
  if (excludeProjects.length > 0) optional.excludeProjects = excludeProjects;

  const base: ResolvedLinearFilter = { requireAllLabels, ...optional };

  const assigneeClause = assigneeClauses[0];
  if (!assigneeClause) return base;

  const value = assigneeClause.value.trim();
  const lower = value.toLowerCase();
  if (lower === "any") return { anyAssignee: true, ...base };
  // Blank value preserves the legacy "blank means unassigned" meaning.
  if (lower === "" || lower === "unassigned") {
    return { assignee: "unassigned", ...base };
  }
  if (lower === "me") return { assignee: "me", ...base };
  // Emails / ids are case-sensitive in Linear lookups — keep original case.
  return { assignee: value, ...base };
}

/** Collect deduped, order-preserving `value`s of one marker type at the given
 *  negation polarity (a missing `negate` reads as positive). */
function collectDeduped(
  filter: LinearFilter,
  type: "label" | "project",
  negated: boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const marker of filter) {
    if (marker.type !== type) continue;
    if (Boolean(marker.negate) !== negated) continue;
    if (seen.has(marker.value)) continue;
    seen.add(marker.value);
    out.push(marker.value);
  }
  return out;
}

/**
 * Apply a runtime assignee override (e.g. the `--linear-assignee` CLI flag) onto
 * a config filter: drop any existing `assignee` clause and append the override,
 * leaving the label clauses intact. A blank override returns the filter as-is.
 */
export function applyAssigneeOverride(filter: LinearFilter, assignee: string): LinearFilter {
  const trimmed = assignee.trim();
  if (trimmed === "") return filter;
  return [
    ...filter.filter((marker) => marker.type !== "assignee"),
    { type: "assignee", value: trimmed },
  ];
}

// ─── Marker grammar ──────────────────────────────────────────────────────────
//
// The Zod side of the same vocabulary the resolver above consumes: the
// discriminated `{type, value}` union that lifecycle indicators and
// `linear.filter` are both written in, plus the `!value` negation shorthand.
// `schema.ts` composes these into `WorkflowConfigSchema`; they live here rather
// than there so the marker grammar and its resolver read as one unit.

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
