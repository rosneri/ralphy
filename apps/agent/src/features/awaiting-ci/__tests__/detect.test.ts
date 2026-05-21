import { describe, expect, test } from "bun:test";
import { makeBareCtx } from "../../../__test-utils__/recording-bus";
import { detectAwaitingCi } from "../detect";
import type { FeatureCtx } from "../../types";

describe("awaiting-ci/detect", () => {
  test("returns match when router assigned the awaiting-ci flow", async () => {
    const base = makeBareCtx();
    const ctx: FeatureCtx = {
      ...base,
      poll: Object.assign(base.poll, { flowAssignment: { flowId: "awaiting-ci" } }),
    };
    expect(await detectAwaitingCi(ctx)).toEqual({ reason: "router:awaiting-ci" });
  });

  test("returns null when no router assignment is present", async () => {
    expect(await detectAwaitingCi(makeBareCtx())).toBeNull();
  });

  test("returns null when assignment names a different flow", async () => {
    const base = makeBareCtx();
    const ctx: FeatureCtx = {
      ...base,
      poll: Object.assign(base.poll, { flowAssignment: { flowId: "implement" } }),
    };
    expect(await detectAwaitingCi(ctx)).toBeNull();
  });
});
