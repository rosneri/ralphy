import type { Bus, EmitInput } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.mention.*` events.
 *
 *  The slice intentionally never writes the `state.confirmation` slot —
 *  per the boundary spec in
 *  `openspec/changes/rlf-94-stage-5-migrate-features-vertically/specs/agent-features-vertical/spec.md`
 *  it MUST instead emit `feature.mention.reviseComment` events that the
 *  confirmation slice consumes to drive its own state writes. Centralizing
 *  the emit here keeps the cross-feature seam grep-able and the boundary
 *  test enforceable. */

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

export interface MentionReviseCommentPayload {
  /** Linear issue identifier (e.g. "RLF-99") the mention was found on. */
  issueIdentifier: string;
  /** Origin of the mention — Linear comment, GitHub PR comment, etc. */
  source: "linear" | "github" | "github-review";
  /** ISO-8601 timestamp of the mention comment. */
  at: string;
  /** Free-form body of the mention comment (the directive text). */
  body: string;
}

/** Signal the confirmation slice that an @ralphy mention asks for a
 *  revise. Carries enough payload for the consumer to act without
 *  reaching back into the mention slice's source. */
export function emitMentionReviseComment(bus: Bus, payload: MentionReviseCommentPayload): void {
  emit(bus, "feature.mention.reviseComment", payload);
}

export function emitMentionSkipped(bus: Bus, reason: string): void {
  emit(bus, "feature.mention.skipped", { reason });
}
