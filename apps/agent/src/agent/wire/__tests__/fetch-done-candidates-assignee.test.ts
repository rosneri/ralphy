import { describe, expect, test } from "bun:test";
import type { Marker } from "@ralphy/types";
import { doneCandidateSpec } from "../linear-resolvers";

// `doneCandidateSpec` is the line that decides how the done-candidate PR/CI scan
// scopes its Linear query. It used to hardcode an all-assignee scan, which pulled
// teammates' PRs into the CI watch — these assert it now carries the global
// filter's assignee + required-label scope. Pure, so no module mocking is needed.

const include: Marker[] = [{ type: "status", value: "In Review" }];

describe("doneCandidateSpec", () => {
  test("scopes the scan to the configured assignee (does not force anyAssignee)", () => {
    const spec = doneCandidateSpec("BAN", "me", false, undefined, include, undefined);
    expect(spec.assignee).toBe("me");
    expect(spec.anyAssignee).toBeFalsy();
  });

  test("honors anyAssignee when the filter is `assignee = any`", () => {
    const spec = doneCandidateSpec("BAN", undefined, true, undefined, include, undefined);
    expect(spec.anyAssignee).toBe(true);
  });

  test("propagates the global filter's required labels", () => {
    const spec = doneCandidateSpec("BAN", "me", false, ["ralph"], include, undefined);
    expect(spec.requireAllLabels).toEqual(["ralph"]);
  });

  test("includes the indicator markers and the per-ticket number constraint", () => {
    const spec = doneCandidateSpec("BAN", "me", false, ["ralph"], include, [812]);
    expect(spec.include).toEqual(include);
    expect(spec.numbers).toEqual([812]);
  });
});
