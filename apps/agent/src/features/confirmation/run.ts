import type { FeatureCtx } from "../types";

/**
 * Run the confirmation feature for this poll.
 *
 * Detection already verified the ticket is in the awaiting-confirmation
 * gate. Run posts the plan-ready comment (idempotent), inspects the
 * ticket for human signals (approve / revise), persists the resulting
 * `confirmation` state slot, and surfaces an `onAwaitingTicket` callback
 * when the ticket stays gated. All of that is closed-over by wire's
 * `caps.confirmation.run`; the slice itself just delegates.
 */
export async function runConfirmation(ctx: FeatureCtx): Promise<void> {
  const caps = ctx.caps.confirmation;
  if (!caps) return;
  await caps.run(ctx.issue);
}
