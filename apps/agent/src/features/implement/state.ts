import type { StateStore } from "../types";

/**
 * Typed accessor for the `pr` slot in `.ralph-state.json`.
 *
 * The slice is the single writer of `state.pr`. `writeField` from
 * `@ralphy/core/state` enforces the ownership invariant at runtime —
 * calls from any other feature throw `OwnershipError` before touching
 * disk. This accessor exists so the slice's call sites are centralized
 * and the persisted shape stays stable.
 */
export interface PrSlot {
  /** Last observed PR URL associated with the issue's branch. */
  url?: string;
  /** ISO timestamp of when the slice first recorded the URL. */
  openedAt?: string;
}

export async function writePrUrl(state: StateStore, url: string, openedAt: string): Promise<void> {
  await state.writeField("pr.url", url);
  await state.writeField("pr.openedAt", openedAt);
}
