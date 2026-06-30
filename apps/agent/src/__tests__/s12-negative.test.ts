/**
 * S12 negative-test suite — error paths and refusals (RLF-112).
 *
 * Scenarios covered:
 *   S12.4 — LINEAR_API_KEY set but Linear returns 401 → non-retried throw
 *   S12.6 — git in detached HEAD (todo: git preflight not yet implemented)
 *   S12.7 — no `main` branch on local repo (todo: prBaseBranch preflight not yet implemented)
 */
import { afterEach, describe, expect, test } from "bun:test";
import { fetchOpenIssues } from "../shared/capabilities/linear-client/issues";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("S12.4 — LINEAR_API_KEY set but Linear returns 401", () => {
  test("fetchOpenIssues throws immediately with status 401 and does not retry", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount++;
      return new Response("{}", { status: 401 });
    }) as typeof fetch;

    let caughtError: (Error & { status?: number }) | null = null;
    try {
      await fetchOpenIssues("invalid-key", {});
    } catch (e) {
      caughtError = e as Error & { status?: number };
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.status).toBe(401);
    // 401 is not in isRetryableStatus (5xx only) — exactly one attempt
    expect(callCount).toBe(1);
  });
});

describe("S12.6 — git in detached HEAD", () => {
  test.skip(
    "agent refuses with a recovery hint when the repo is in detached HEAD state " +
      "(no git preflight check exists yet — file a bug under RLF-99 if this is needed)",
    () => {},
  );
});

describe("S12.7 — no `main` branch on local repo", () => {
  test.skip(
    "agent fails preflight and suggests --pr-base-branch when `main` does not exist " +
      "(no prBaseBranch preflight check exists yet — file a bug under RLF-99 if this is needed)",
    () => {},
  );
});
