export interface GateInputs {
  config: {
    confirmationMode: {
      enabled: boolean;
    };
  };
  persistedConfirmation: { confirmedAt: string | null };
}

/**
 * True when the confirmation gate is currently blocking a ticket.
 *
 * Short-circuits, in order:
 *   1. confirmation mode disabled in config → not active
 *   2. approval already persisted on disk → not active (the watermark is
 *      permanent for the change)
 *   3. otherwise → active
 *
 * Opt-in / opt-out logic now lives in computeConfirmationFlags (indicators).
 */
export function gateActive(inputs: GateInputs): boolean {
  if (!inputs.config.confirmationMode.enabled) return false;
  if (inputs.persistedConfirmation.confirmedAt !== null) return false;
  return true;
}
