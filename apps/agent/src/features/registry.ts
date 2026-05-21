/**
 * Ordered registry of `Feature` descriptors consumed by `coordinator.ts`
 * and `post-task.ts`. The order matches today's implicit precedence in
 * the legacy `if/else if` chain — the first feature whose `detect`
 * returns a non-null `FeatureMatch` wins the poll.
 *
 * Until each per-feature slice ships under `features/<id>/`, the entries
 * here are stub adapters: `detect` returns `null` so the legacy branches
 * in `coordinator.ts` still own behavior. The registry exists from day
 * one so the dispatch path (registry walk + `runFeature` event shape) is
 * exercised end-to-end and each slice can swap its adapter for the real
 * descriptor without touching the coordinator wiring.
 *
 * Cross-feature imports are forbidden by the boundary test under
 * `apps/agent/src/__tests__/feature-boundaries.test.ts` — feature
 * descriptors land in this file via their own `features/<id>/index.ts`
 * once they exist, never by reaching into sibling slices.
 */

import type { Feature, FeatureId, StateSlotName } from "./types";
import { confirmationFeature } from "./confirmation";
import { conflictFixFeature } from "./conflict-fix";
import { ciFixFeature } from "./ci-fix";
import { implementFeature } from "./implement";

function stubFeature(id: FeatureId, ownedSlot: StateSlotName | null): Feature {
  return {
    id,
    ownedSlot,
    async detect() {
      return null;
    },
    async run() {
      // No-op: legacy branches in coordinator.ts still own behavior
      // until this slice's real descriptor replaces the stub.
    },
  };
}

export const registry: readonly Feature[] = [
  confirmationFeature,
  conflictFixFeature,
  ciFixFeature,
  implementFeature,
  stubFeature("review-followup", "review"),
  stubFeature("new-ticket", null),
  stubFeature("mention", null),
  stubFeature("stuck", null),
];
