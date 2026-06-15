import { describe, expect, test } from "bun:test";
import { buildProtectionPayload } from "../apply-branch-protection";
import { BRANCH, ENFORCE_ADMINS, REQUIRED_CHECKS, STRICT } from "../branch-protection.config";
import { diffProtection } from "../check-branch-protection";

describe("branch-protection.config", () => {
  test("requires the `ci` check on main, strict + admin-enforced", () => {
    expect(BRANCH).toBe("main");
    expect(REQUIRED_CHECKS).toEqual(["ci"]);
    expect(STRICT).toBe(true);
    expect(ENFORCE_ADMINS).toBe(true);
  });
});

describe("buildProtectionPayload", () => {
  test("encodes the config into the GitHub protection API shape", () => {
    const payload = JSON.parse(buildProtectionPayload());
    expect(payload).toEqual({
      required_status_checks: { strict: true, contexts: ["ci"] },
      enforce_admins: true,
      required_pull_request_reviews: null,
      restrictions: null,
    });
  });
});

describe("diffProtection", () => {
  test("reports no drift when live protection matches the config", () => {
    const drift = diffProtection({
      required_status_checks: { strict: true, contexts: ["ci"] },
      enforce_admins: { enabled: true },
    });
    expect(drift).toEqual([]);
  });

  test("flags a missing required status check", () => {
    const drift = diffProtection({
      required_status_checks: { strict: true, contexts: [] },
      enforce_admins: { enabled: true },
    });
    expect(drift).toEqual(['required status check "ci" is missing']);
  });

  test("flags strict drift", () => {
    const drift = diffProtection({
      required_status_checks: { strict: false, contexts: ["ci"] },
      enforce_admins: { enabled: true },
    });
    expect(drift).toEqual(["strict should be true, live is false"]);
  });

  test("flags admin-enforcement drift and accepts the boolean form", () => {
    const drift = diffProtection({
      required_status_checks: { strict: true, contexts: ["ci"] },
      enforce_admins: false,
    });
    expect(drift).toEqual(["enforce_admins should be true, live is false"]);
  });

  test("treats absent protection sections as fully drifted", () => {
    const drift = diffProtection({});
    expect(drift).toEqual([
      'required status check "ci" is missing',
      "strict should be true, live is false",
      "enforce_admins should be true, live is false",
    ]);
  });
});
