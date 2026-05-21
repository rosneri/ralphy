import { describe, expect, it } from "bun:test";
import { route } from "../router";
import type { BoostBand, FlowId, RouterSignals } from "../types";

/**
 * Property test by exhaustive enumeration. The `RouterSignals` union
 * fields are small finite sets, so the cross-product (≈ 4608 cases) is
 * cheap to enumerate. This is stronger than a sampled property test:
 * every signal in the input space is checked.
 */
const buckets: RouterSignals["bucket"][] = [
  "todo",
  "in-progress",
  "review",
  "conflicted",
  "done",
  "cancelled",
];
const prStatuses: RouterSignals["prStatus"][] = [
  "none",
  "mergeable",
  "conflicting",
  "ci-failing",
  "ci-pending",
  "unknown",
];
const awaitings: RouterSignals["awaiting"][] = ["none", "awaiting", "approved", "revise"];
const mentions: RouterSignals["mention"][] = ["none", "revise", "new-ticket", "stuck"];
const stucks: boolean[] = [false, true];
const boosts: BoostBand[] = ["p0", "p1", "p2", "p3"];
const awaitingCis: RouterSignals["awaitingCi"][] = ["none", "watching"];

const knownFlowIds: ReadonlySet<FlowId> = new Set<FlowId>([
  "confirmation",
  "conflict-fix",
  "ci-fix",
  "awaiting-ci",
  "review-followup",
  "implement",
  "new-ticket",
  "mention",
  "stuck",
  "idle",
]);

describe("router totality (property)", () => {
  it("returns a known flowId for every signal in the cross-product", () => {
    let count = 0;
    for (const bucket of buckets) {
      for (const prStatus of prStatuses) {
        for (const awaiting of awaitings) {
          for (const mention of mentions) {
            for (const stuck of stucks) {
              for (const boost of boosts) {
                for (const awaitingCi of awaitingCis) {
                  const signals: RouterSignals = {
                    bucket,
                    prStatus,
                    awaiting,
                    mention,
                    stuck,
                    boost,
                    awaitingCi,
                  };
                  const assignment = route(signals);
                  expect(assignment).toBeDefined();
                  expect(knownFlowIds.has(assignment.flowId)).toBe(true);
                  expect(assignment.boost).toBe(boost);
                  count += 1;
                }
              }
            }
          }
        }
      }
    }
    // Sanity: we enumerated the full product (6*6*4*4*2*4*2 = 9216).
    expect(count).toBe(9216);
  });
});
