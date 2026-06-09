import type { WorkflowConfig } from "./schema";

/**
 * Minimal Linear-issue shape needed to evaluate the confirmation gate
 * client-side. Kept here (instead of importing `LinearIssue`) so this module
 * stays in `@ralphy/workflow` and free of an apps/agent dependency.
 */
export interface ConfirmationTicketView {
  labels: readonly string[];
  state: { name: string; type: string };
  project?: { id: string; name: string } | null;
  /** Source-types of attachments on the issue. Empty/undefined when unknown. */
  attachmentSourceTypes?: readonly string[];
  /** Bodies of non-Ralph comments on the issue. Empty/undefined when unknown. */
  commentBodies?: readonly string[];
}

type Marker = {
  type: "label" | "status" | "attachment" | "project" | "comment";
  value: string;
};

interface GetIndicatorLike {
  filter: readonly Marker[];
}

/**
 * Client-side mirror of Linear's `clauseFromMarkers` grouping: markers of the
 * same `type` are OR-ed; types are AND-ed. Matches the semantics the Linear
 * GraphQL filter applies on the server.
 */
export function matchesIndicator(
  indicator: GetIndicatorLike | undefined,
  ticket: ConfirmationTicketView,
): boolean {
  if (!indicator || indicator.filter.length === 0) return false;
  const byType = new Map<Marker["type"], string[]>();
  for (const m of indicator.filter) {
    const bucket = byType.get(m.type) ?? [];
    bucket.push(m.value);
    byType.set(m.type, bucket);
  }
  for (const [type, values] of byType) {
    if (!matchesAnyValue(type, values, ticket)) return false;
  }
  return true;
}

function matchesAnyValue(
  type: Marker["type"],
  values: readonly string[],
  ticket: ConfirmationTicketView,
): boolean {
  switch (type) {
    case "label":
      return values.some((v) => ticket.labels.includes(v));
    case "status":
      return values.includes(ticket.state.name);
    case "project":
      return ticket.project != null && values.includes(ticket.project.name);
    case "attachment":
      return (ticket.attachmentSourceTypes ?? []).some((s) => values.includes(s));
    case "comment": {
      const bodies = ticket.commentBodies ?? [];
      if (bodies.length === 0) return false;
      return values.some((v) => {
        const needle = v.toLowerCase();
        return bodies.some((b) => b.toLowerCase().includes(needle));
      });
    }
  }
}

/**
 * Compute the two deriver inputs for the confirmation gate.
 *
 *   `confirmationGated` — confirmation mode is on AND the ticket satisfies the
 *                         opt-in (`getConfirmGate`).
 *   `approved`          — the `getApproved` indicator (if any) matches the
 *                         ticket's current labels / status / project. Tickets
 *                         meant to flow through unattended (e.g. `auto-merge`)
 *                         are folded into `getApproved`, so they read as
 *                         approved rather than needing a separate opt-out.
 */
export function computeConfirmationFlags(
  config: WorkflowConfig,
  ticket: ConfirmationTicketView,
): { confirmationGated: boolean; approved: boolean } {
  const cm = config.linear.confirmationMode;
  const { getConfirmGate, getApproved } = config.linear.indicators;
  const optInSatisfied = !getConfirmGate || matchesIndicator(getConfirmGate, ticket);
  const confirmationGated = cm.enabled && optInSatisfied;
  const approved = matchesIndicator(getApproved, ticket);
  return { confirmationGated, approved };
}

/**
 * Format the `getApproved` indicator into a human-readable sentence used in
 * the "📋 Ralphy plan ready" comment body. Returns a generic fallback when
 * the indicator is missing or has no filter entries.
 */
export function describeApprovalMarker(indicator: GetIndicatorLike | undefined): string {
  if (!indicator || indicator.filter.length === 0) {
    return "ask your operator to approve this plan";
  }
  const phrases = indicator.filter.map((m) => {
    switch (m.type) {
      case "label":
        return `apply the \`${m.value}\` label`;
      case "status":
        return `move the issue to status \`${m.value}\``;
      case "project":
        return `move the issue into project \`${m.value}\``;
      case "attachment":
        return `attach a \`${m.value}\``;
      case "comment":
        return `post a comment containing \`${m.value}\``;
    }
  });
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]} or ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]}`;
}
