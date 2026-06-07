/**
 * Tests for `isRalphComment` — the self-authored-comment filter used by the
 * mention scan (`mention-scan.ts`) and `hasMentionTrigger`
 * (`linear-client.ts`) to skip Ralphy's own comments when deciding whether a
 * new @mention warrants a review pass.
 *
 * Regression: the mention-ack comment leads with `👀 Got it, …` /
 * `👀 Acknowledged! …`, which did NOT match the recognized lead set, so
 * Ralphy treated its own ack as a fresh human mention and re-acked it every
 * poll cycle — a runaway self-mention loop (LIT-408: ~47 identical acks at a
 * ~60s cadence on rosneri/litrpg-new#607).
 */
import { describe, expect, test } from "bun:test";
import { isRalphComment } from "../shared/utils/ralph-comment";

const ACK_GOT_IT =
  "👀 Got it, Neriya Rosner! I've picked up your mention and queued a review pass.\n\n" +
  "> 👀 Got it, Neriya Rosner! I've picked up your mention and queued a review pass.";
const ACK_ANON = "👀 Acknowledged! I've picked up your mention and queued a review pass.";

describe("isRalphComment", () => {
  // Regression guard for the LIT-408 self-mention loop: the 👀 mention-ack
  // MUST be recognized as Ralphy-authored so the scan skips it.
  test("recognizes the 👀 mention-ack as Ralphy-authored (LIT-408)", () => {
    expect(isRalphComment(ACK_GOT_IT)).toBe(true);
    expect(isRalphComment(ACK_ANON)).toBe(true);
  });

  test("still recognizes the established emoji-lead comment forms", () => {
    expect(isRalphComment("🤖 Ralphy started work on this issue.")).toBe(true);
    expect(isRalphComment("🔄 Ralphy progress update.")).toBe(true);
    expect(isRalphComment("✅ Ralph completed work on this issue.")).toBe(true);
    expect(isRalphComment("⚠ Ralph detected failing CI on this PR.")).toBe(true);
    expect(isRalphComment("🔁 Ralphy is revising.")).toBe(true);
    expect(isRalphComment("📋 Ralphy plan ready.")).toBe(true);
    expect(isRalphComment("⏰ Ralphy reminder: Approve to continue.")).toBe(true);
  });

  test("does not flag genuine human comments", () => {
    expect(isRalphComment("@ralphy please retry")).toBe(false);
    expect(isRalphComment("👀 looking into this myself, hold off")).toBe(false);
    expect(isRalphComment("Got it, will review")).toBe(false);
  });
});
