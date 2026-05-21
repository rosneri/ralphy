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
export async function writePrUrl(state: StateStore, url: string, openedAt: string): Promise<void> {
  await state.writeField("pr.url", url);
  await state.writeField("pr.openedAt", openedAt);
}

/** Set the issue's tracked flow id. Written immediately after the PR URL
 *  so the router can route the next poll to the awaiting-ci slice. */
export async function writeFlow(state: StateStore, flow: "awaiting-ci"): Promise<void> {
  await state.writeField("pr.flow", flow);
}
