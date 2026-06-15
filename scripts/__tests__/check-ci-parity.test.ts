import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CI_ONLY_ALLOWLIST, computeParity, extractChecks, gatherSets } from "../check-ci-parity";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("extractChecks", () => {
  test("extracts direct scripts/check-*.ts and .sh references", () => {
    const text = "bun scripts/check-foo.ts && bash scripts/check-bar.sh";
    expect(extractChecks(text, {})).toEqual(new Set(["check-foo", "check-bar"]));
  });

  test("resolves `bun run check:shell` indirection to its underlying script", () => {
    const pkgScripts = { "check:shell": "bash scripts/check-shell.sh" };
    expect(extractChecks("bun run check:shell", pkgScripts)).toEqual(new Set(["check-shell"]));
  });

  test("resolves nested `bun run` chains without infinite recursion", () => {
    const pkgScripts = {
      "check:structure": "bun scripts/check-a.ts && bun run check:more",
      "check:more": "bun scripts/check-b.ts && bun run check:structure",
    };
    expect(extractChecks("bun run check:structure", pkgScripts)).toEqual(
      new Set(["check-a", "check-b"]),
    );
  });

  test("ignores `bun run` targets that contain no check-* scripts", () => {
    const pkgScripts = { "lint:ci": "nx affected -t lint" };
    expect(extractChecks("bun run lint:ci", pkgScripts)).toEqual(new Set());
  });
});

describe("computeParity", () => {
  const allowlist = new Set(["check-outdated"]);

  test("holds when local gates ⊆ CI and CI ⊆ local ∪ allowlist", () => {
    const result = computeParity({
      preCommit: new Set(["check-a", "check-b"]),
      prePush: new Set(["check-dup"]),
      ci: new Set(["check-a", "check-b", "check-dup", "check-outdated"]),
      allowlist,
    });
    expect(result.missingInCi).toEqual([]);
    expect(result.unexpectedInCi).toEqual([]);
  });

  test("FAILS when a hook-only check is missing from CI (local stricter than CI)", () => {
    const result = computeParity({
      preCommit: new Set(["check-a", "check-local-only"]),
      prePush: new Set(),
      ci: new Set(["check-a"]),
      allowlist,
    });
    expect(result.missingInCi).toEqual(["check-local-only"]);
    expect(result.unexpectedInCi).toEqual([]);
  });

  test("counts a pre-push-only check as a local gate that CI must include", () => {
    const result = computeParity({
      preCommit: new Set(["check-a"]),
      prePush: new Set(["check-push-only"]),
      ci: new Set(["check-a"]),
      allowlist,
    });
    expect(result.missingInCi).toEqual(["check-push-only"]);
  });

  test("FAILS when CI runs a non-allowlisted check absent from every hook", () => {
    const result = computeParity({
      preCommit: new Set(["check-a"]),
      prePush: new Set(),
      ci: new Set(["check-a", "check-ci-only"]),
      allowlist,
    });
    expect(result.missingInCi).toEqual([]);
    expect(result.unexpectedInCi).toEqual(["check-ci-only"]);
  });

  test("allowlisted CI-only checks do not trip the second invariant", () => {
    const result = computeParity({
      preCommit: new Set(["check-a"]),
      prePush: new Set(),
      ci: new Set(["check-a", "check-outdated"]),
      allowlist,
    });
    expect(result.unexpectedInCi).toEqual([]);
  });
});

describe("guard over the real tree", () => {
  test("the repo currently satisfies CI ↔ local parity", async () => {
    const { preCommit, prePush, ci } = await gatherSets(REPO_ROOT);
    const result = computeParity({ preCommit, prePush, ci, allowlist: CI_ONLY_ALLOWLIST });
    expect(result.missingInCi).toEqual([]);
    expect(result.unexpectedInCi).toEqual([]);
  });

  test("check:shell indirection resolves so check-shell counts in both surfaces", async () => {
    const { preCommit, ci } = await gatherSets(REPO_ROOT);
    expect(preCommit.has("check-shell")).toBe(true);
    expect(ci.has("check-shell")).toBe(true);
  });
});
