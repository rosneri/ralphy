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

import type { LinearFilter, ResolvedLinearFilter } from "@ralphy/types";

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

  const requireAllLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const marker of filter) {
    if (marker.type !== "label") continue;
    if (seenLabels.has(marker.value)) continue;
    seenLabels.add(marker.value);
    requireAllLabels.push(marker.value);
  }

  const assigneeClause = assigneeClauses[0];
  if (!assigneeClause) return { requireAllLabels };

  const value = assigneeClause.value.trim();
  const lower = value.toLowerCase();
  if (lower === "any") return { anyAssignee: true, requireAllLabels };
  // Blank value preserves the legacy "blank means unassigned" meaning.
  if (lower === "" || lower === "unassigned") {
    return { assignee: "unassigned", requireAllLabels };
  }
  if (lower === "me") return { assignee: "me", requireAllLabels };
  // Emails / ids are case-sensitive in Linear lookups — keep original case.
  return { assignee: value, requireAllLabels };
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
