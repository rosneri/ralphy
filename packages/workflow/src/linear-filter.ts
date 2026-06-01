/**
 * Parser for the global `linear.filter` expression (RLF-206).
 *
 * `linear.filter` replaces the old per-workflow `linear.assignee` string with a
 * small, extensible filter grammar applied to every Linear ticket fetch. The
 * initial grammar recognizes exactly one clause:
 *
 *   assignee = <value>      # value ∈ { me, any, unassigned, <email>, <user-id> }
 *
 * The parser maps the clause into the existing `LinearFilterSpec` assignee
 * fields so the GraphQL layer below it is untouched:
 *
 *   | filter value            | parsed result               |
 *   |-------------------------|-----------------------------|
 *   | (blank)                 | { assignee: "me" }          |
 *   | assignee = me           | { assignee: "me" }          |
 *   | assignee = any          | { anyAssignee: true }       |
 *   | assignee = unassigned   | { assignee: "unassigned" }  |
 *   | assignee = <email>      | { assignee: "<email>" }     |
 *   | assignee = <id>         | { assignee: "<id>" }        |
 *
 * The grammar is deliberately a single helper so additional keys
 * (status/label/team/project) can be added later without touching call sites.
 */

export interface LinearFilterResult {
  /** Assignee selector passed straight to `LinearFilterSpec.assignee`. */
  assignee?: string;
  /** When true, skip the assignee constraint entirely (`assignee = any`). */
  anyAssignee?: boolean;
}

/** Keys the filter grammar understands today. */
const SUPPORTED_KEYS = new Set(["assignee"]);

/**
 * Parse a single-clause `linear.filter` expression. A blank expression
 * defaults to `assignee = me`. Throws a clear error naming any unrecognized
 * key so a typo fails loudly at config-load time.
 */
export function parseLinearFilter(filter: string): LinearFilterResult {
  const trimmed = filter.trim();
  if (trimmed === "") return { assignee: "me" };

  const eq = trimmed.indexOf("=");
  if (eq < 0) {
    throw new Error(
      `Invalid linear.filter "${filter}": expected "<key> = <value>" (e.g. "assignee = me").`,
    );
  }
  const key = trimmed.slice(0, eq).trim().toLowerCase();
  const value = trimmed.slice(eq + 1).trim();

  if (!SUPPORTED_KEYS.has(key)) {
    throw new Error(
      `Unrecognized linear.filter key "${key}" in "${filter}". Supported keys: ${[...SUPPORTED_KEYS].join(", ")}.`,
    );
  }

  // key === "assignee"
  const lower = value.toLowerCase();
  if (lower === "any") return { anyAssignee: true };
  // Blank value preserves the legacy "blank means unassigned" meaning.
  if (lower === "" || lower === "unassigned") return { assignee: "unassigned" };
  if (lower === "me") return { assignee: "me" };
  // Emails / ids are case-sensitive in Linear lookups — keep original case.
  return { assignee: value };
}
