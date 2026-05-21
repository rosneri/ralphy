import { describe, expect, test } from "bun:test";
import { runCiFix } from "../features/ci-fix/run";
import { runConflictFix } from "../features/conflict-fix/run";
import { runImplement } from "../features/implement/run";
import { runReviewFollowup } from "../features/review-followup/run";
import { makeBareCtx } from "../__test-utils__/recording-bus";

// Each slice keeps a typed no-op `run` so the Feature contract stays
// uniform — these exist purely so detect/run signatures line up across
// slices whose work happens elsewhere (postTask or feature-specific
// detection that always returns null). The smoke test pins them as
// resolved promises so coverage reflects that they're reachable.
describe("feature run stubs are typed no-ops", () => {
  const ctx = makeBareCtx();

  test("runCiFix resolves without effect", async () => {
    await expect(runCiFix(ctx)).resolves.toBeUndefined();
  });

  test("runConflictFix resolves without effect", async () => {
    await expect(runConflictFix(ctx)).resolves.toBeUndefined();
  });

  test("runImplement resolves without effect", async () => {
    await expect(runImplement(ctx)).resolves.toBeUndefined();
  });

  test("runReviewFollowup resolves without effect", async () => {
    await expect(runReviewFollowup(ctx)).resolves.toBeUndefined();
  });
});
