import { describe, expect, test } from "bun:test";
import {
  computeWantPr,
  computeWantValidateOnly,
  releaseWorkerMaps,
  type WorkerChangeMaps,
} from "../spawn/worker";
import type { LinearIssue } from "../../linear";

// Pure decisions extracted from the spawn-worker exit handler, asserted
// without constructing the closure (the release-maps.ts pattern).

describe("computeWantPr", () => {
  test("wants a PR when base intent is set and not awaiting", () => {
    expect(computeWantPr(true, false, false)).toBe(true);
  });

  test("suppresses the PR when reaped into awaitingChangeSet", () => {
    expect(computeWantPr(true, true, false)).toBe(false);
  });

  test("suppresses the PR when coordinator is awaiting confirmation", () => {
    expect(computeWantPr(true, false, true)).toBe(false);
  });

  test("never wants a PR without the base intent", () => {
    expect(computeWantPr(false, false, false)).toBe(false);
    expect(computeWantPr(false, true, true)).toBe(false);
  });
});

describe("computeWantValidateOnly", () => {
  test("true only when a validate spec is present and there is no PR intent", () => {
    expect(computeWantValidateOnly(true, false)).toBe(true);
  });

  test("false when a PR is wanted (PR supersedes validate-only)", () => {
    expect(computeWantValidateOnly(true, true)).toBe(false);
  });

  test("false when there is no validate spec", () => {
    expect(computeWantValidateOnly(false, false)).toBe(false);
    expect(computeWantValidateOnly(false, true)).toBe(false);
  });
});

describe("releaseWorkerMaps", () => {
  test("clears the change key from all four per-change maps", () => {
    const issue = { id: "i1", identifier: "RLF-1" } as LinearIssue;
    const maps: WorkerChangeMaps = {
      cwdByChange: new Map([["c", "/cwd"]]),
      statesDirByChange: new Map([["c", "/states"]]),
      branchByChange: new Map([["c", "branch"]]),
      issueByChange: new Map([["c", issue]]),
    };

    releaseWorkerMaps(maps, "c");

    expect(maps.cwdByChange.has("c")).toBe(false);
    expect(maps.statesDirByChange.has("c")).toBe(false);
    expect(maps.branchByChange.has("c")).toBe(false);
    expect(maps.issueByChange.has("c")).toBe(false);
  });

  test("leaves entries for other changes untouched", () => {
    const maps: WorkerChangeMaps = {
      cwdByChange: new Map([
        ["c", "/cwd"],
        ["other", "/other"],
      ]),
      statesDirByChange: new Map([["other", "/states"]]),
      branchByChange: new Map([["other", "branch"]]),
      issueByChange: new Map(),
    };

    releaseWorkerMaps(maps, "c");

    expect(maps.cwdByChange.has("other")).toBe(true);
    expect(maps.statesDirByChange.has("other")).toBe(true);
  });
});
