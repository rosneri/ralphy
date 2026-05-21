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

import type { Bus } from "@ralphy/events";
import type { Capabilities, Feature, FeatureId } from "./types";
import { confirmationFeature } from "./confirmation";
import { conflictFixFeature } from "./conflict-fix";
import { ciFixFeature } from "./ci-fix";
import { awaitingCiFeature } from "./awaiting-ci";
import { implementFeature } from "./implement";
import { reviewFollowupFeature } from "./review-followup";
import { newTicketFeature } from "./new-ticket";
import { mentionFeature } from "./mention";
import { stuckFeature } from "./stuck";

export const registry: readonly Feature[] = [
  confirmationFeature,
  conflictFixFeature,
  ciFixFeature,
  awaitingCiFeature,
  implementFeature,
  reviewFollowupFeature,
  newTicketFeature,
  mentionFeature,
  stuckFeature,
];

/**
 * Capability requirements per feature, used by `selectRegistry` to filter
 * features whose required capability bundle is missing from `caps`. Each
 * entry returns `null` when the feature is satisfied, or a non-empty
 * reason string explaining what is missing.
 */
type FeatureRequirement = (caps: Capabilities) => string | null;

const REQUIREMENTS: Readonly<Record<FeatureId, FeatureRequirement>> = {
  confirmation: (caps) =>
    caps.confirmation == null ? "missing confirmation capability bundle" : null,
  "conflict-fix": (caps) => {
    if (caps.gh == null) return "missing gh capability (required for conflict-fix)";
    if (caps.conflictFix == null) return "missing conflictFix capability bundle";
    return null;
  },
  "ci-fix": (caps) => {
    if (caps.gh == null) return "missing gh capability (required for ci-fix)";
    if (caps.ciFix == null) return "missing ciFix capability bundle";
    return null;
  },
  "awaiting-ci": (caps) => {
    if (caps.gh == null) return "missing gh capability (required for awaiting-ci)";
    if (caps.ciFix == null) return "missing ciFix capability bundle (required for awaiting-ci)";
    return null;
  },
  implement: (caps) => {
    if (caps.gh == null) return "missing gh capability (required for implement)";
    if (caps.implement == null) return "missing implement capability bundle";
    return null;
  },
  "review-followup": (caps) =>
    caps.gh == null ? "missing gh capability (required for review-followup)" : null,
  "new-ticket": (caps) =>
    caps.linear == null ? "missing linear capability (required for new-ticket)" : null,
  mention: (caps) =>
    caps.linear == null ? "missing linear capability (required for mention)" : null,
  stuck: (caps) => (caps.linear == null ? "missing linear capability (required for stuck)" : null),
};

/**
 * Filter the registry by capability availability. Emits a
 * `feature.<id>.disabled` event for each feature dropped, then returns
 * the active list in original order. Called by `agent/wire.ts`.
 */
export function selectRegistry(
  allFeatures: readonly Feature[],
  caps: Capabilities,
  bus: Bus,
): readonly Feature[] {
  const active: Feature[] = [];
  for (const feature of allFeatures) {
    const check = REQUIREMENTS[feature.id];
    const reason = check === undefined ? null : check(caps);
    if (reason === null) {
      active.push(feature);
      continue;
    }
    bus.emit({
      type: `feature.${feature.id}.disabled` as `feature.${FeatureId}.disabled`,
      reason,
    });
  }
  return active;
}
