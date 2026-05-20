export interface GateInputs {
  config: { confirmationMode: { enabled: boolean; optOutLabel?: string } };
  ticket: { labels: ReadonlyArray<string> };
  persistedConfirmation: { confirmedAt: string | null };
}

/**
 * True when the confirmation gate is currently blocking a ticket.
 *
 * Short-circuits, in order:
 *   1. confirmation mode disabled in config → not active
 *   2. approval already persisted on disk → not active (label can come and go,
 *      the watermark is permanent for the change)
 *   3. opt-out label present on the ticket → not active
 *   4. otherwise → active
 */
export function gateActive(inputs: GateInputs): boolean {
  if (!inputs.config.confirmationMode.enabled) return false;
  if (inputs.persistedConfirmation.confirmedAt !== null) return false;
  const optOut = inputs.config.confirmationMode.optOutLabel;
  if (optOut && inputs.ticket.labels.includes(optOut)) return false;
  return true;
}
