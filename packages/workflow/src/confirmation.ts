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
}

type Marker = { type: "label" | "status" | "attachment" | "project"; value: string };

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
  }
}

/**
 * Compute the two deriver inputs for the confirmation gate.
 *
 *   `confirmationGated` — confirmation mode is on AND the ticket lacks the
 *                         opt-out label.
 *   `approved`          — the `getApproved` indicator (if any) matches the
 *                         ticket's current labels / status / project.
 */
export function computeConfirmationFlags(
  config: WorkflowConfig,
  ticket: ConfirmationTicketView,
): { confirmationGated: boolean; approved: boolean } {
  const cm = config.linear.confirmationMode;
  const optInSatisfied = !cm.optInLabel || ticket.labels.includes(cm.optInLabel);
  const confirmationGated = cm.enabled && optInSatisfied && !ticket.labels.includes(cm.optOutLabel);
  const approved = matchesIndicator(config.linear.indicators.getApproved, ticket);
  return { confirmationGated, approved };
}
