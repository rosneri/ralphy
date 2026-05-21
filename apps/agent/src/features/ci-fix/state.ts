import type { StateStore } from "../types";

/**
 * Typed accessor for the `ci` slot in `.ralph-state.json`.
 *
 * The slice is the single writer of `state.ci`. `writeField` from
 * `@ralphy/core/state` enforces the ownership invariant at runtime —
 * calls from any other feature throw `OwnershipError` before touching
 * disk. This accessor exists so the slice's call sites are centralized
 * and the persisted shape stays stable.
 */
interface CiSlot {
  /** ISO timestamp of the most recent settled CI check the slice observed. */
  lastCheckedAt?: string;
  /** Last observed bucket: "pass" | "fail" | "pending" | "unknown". */
  lastBucket?: "pass" | "fail" | "pending" | "unknown";
}

export async function writeLastChecked(
  state: StateStore,
  at: string,
  bucket: CiSlot["lastBucket"],
): Promise<void> {
  await state.writeField("ci.lastCheckedAt", at);
  await state.writeField("ci.lastBucket", bucket);
}
