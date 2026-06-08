import { describe, expect, test } from "bun:test";
import { createBus } from "@ralphy/events";
import { runCapability } from "../run-capability";
import {
  gh,
  ghCapability,
  formatGhError,
  isAuthError,
  isTransientGhError,
  parseGhRetryAfter,
  MAX_GH_RETRY_AFTER_MS,
} from "../gh-client";
import type { CmdRunner } from "../../../agent/pr";

interface FakeError extends Error {
  stderr?: string;
  code?: number;
}

function mkErr(message: string, stderr: string, code: number): FakeError {
  const e = new Error(message) as FakeError;
  e.stderr = stderr;
  e.code = code;
  return e;
}

function fakeRunner(results: Array<{ ok?: { stdout: string; stderr: string }; err?: FakeError }>) {
  const calls: string[][] = [];
  let i = 0;
  const runner: CmdRunner = {
    run: async (cmd) => {
      calls.push(cmd);
      const next = results[i++];
      if (!next) throw new Error("unexpected extra call");
      if (next.err) throw next.err;
      return next.ok ?? { stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

describe("gh-client capability", () => {
  test("emits started + fetched on success and forwards stdout/stderr", async () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    const { runner, calls } = fakeRunner([{ ok: { stdout: "hello", stderr: "" } }]);
    const out = await runCapability(
      gh,
      { runner, cwd: "/tmp", args: ["pr", "view", "u"] },
      { bus },
    );
    expect(out.stdout).toBe("hello");
    expect(calls[0]).toEqual(["gh", "pr", "view", "u"]);
    expect(seen).toEqual(["gh.cmd.started", "gh.cmd.fetched"]);
  });

  test("retries on transient 5xx then succeeds", async () => {
    const { runner, calls } = fakeRunner([
      { err: mkErr("boom", "HTTP 503: service unavailable", 1) },
      { ok: { stdout: "ok", stderr: "" } },
    ]);
    const out = await runCapability(
      { ...gh, retryPolicy: { ...gh.retryPolicy, delayMs: () => 0 } },
      { runner, cwd: "/tmp", args: ["api", "/x"] },
    );
    expect(out.stdout).toBe("ok");
    expect(calls.length).toBe(2);
  });

  test("does not retry on auth errors", async () => {
    const bus = createBus();
    const failed: string[] = [];
    bus.on("*", (e) => {
      if (e.type !== "gh.cmd.failed") return;
      const errorField = (e as Record<string, unknown>).error;
      if (typeof errorField === "string") failed.push(errorField);
    });
    const { runner, calls } = fakeRunner([
      { err: mkErr("nope", "gh auth login required (HTTP 401)", 1) },
      { ok: { stdout: "should-not-run", stderr: "" } },
    ]);
    await expect(
      runCapability(gh, { runner, cwd: "/tmp", args: ["pr", "view"] }, { bus }),
    ).rejects.toBeDefined();
    expect(calls.length).toBe(1);
    expect(failed[0]).toContain("gh exited 1");
  });

  test("errorFormatter includes exit code and stderr tail", () => {
    const err = mkErr("cmd failed", "line1\nline2\nfinal error message", 42);
    const formatted = formatGhError(err);
    expect(formatted).toContain("gh exited 42");
    expect(formatted).toContain("final error message");
  });

  test("isAuthError detects auth-shaped failures and isTransientGhError ignores them", () => {
    const auth = mkErr("x", "HTTP 401 Unauthorized", 1);
    expect(isAuthError(auth)).toBe(true);
    expect(isTransientGhError(auth)).toBe(false);
    const transient = mkErr("x", "request timed out", 1);
    expect(isAuthError(transient)).toBe(false);
    expect(isTransientGhError(transient)).toBe(true);
    const unknown = mkErr("x", "weird parsing failure", 1);
    expect(isTransientGhError(unknown)).toBe(false);
  });

  test("ghCapability lets call sites use a specific bus prefix", async () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.on("*", (e) => seen.push(e.type));
    const { runner } = fakeRunner([{ ok: { stdout: "", stderr: "" } }]);
    const cap = ghCapability("gh.pr.view");
    await runCapability(cap, { runner, cwd: "/tmp", args: ["pr", "view"] }, { bus });
    expect(seen).toEqual(["gh.pr.view.started", "gh.pr.view.fetched"]);
  });

  test("exhausts retries and emits a single .failed", async () => {
    const bus = createBus();
    const counts: Record<string, number> = {};
    bus.on("*", (e) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    });
    const { runner, calls } = fakeRunner([
      { err: mkErr("a", "HTTP 502", 1) },
      { err: mkErr("b", "HTTP 502", 1) },
      { err: mkErr("c", "HTTP 502", 1) },
    ]);
    await expect(
      runCapability(
        { ...gh, retryPolicy: { ...gh.retryPolicy, delayMs: () => 0 } },
        { runner, cwd: "/tmp", args: ["api", "/x"] },
        { bus },
      ),
    ).rejects.toBeDefined();
    expect(calls.length).toBe(3);
    expect(counts["gh.cmd.failed"]).toBe(1);
    expect(counts["gh.cmd.started"]).toBe(1);
  });
});

describe("rate-limit Retry-After backoff", () => {
  test("parseGhRetryAfter reads seconds, HTTP-date, and try-again phrasing", () => {
    expect(parseGhRetryAfter(mkErr("x", "Retry-After: 2", 1))).toBe(2000);
    expect(parseGhRetryAfter(mkErr("x", "retry-after: 5", 1))).toBe(5000);
    expect(
      parseGhRetryAfter(mkErr("x", "You have exceeded a rate limit. Try again in 30 seconds.", 1)),
    ).toBe(30000);
    expect(parseGhRetryAfter(mkErr("x", "HTTP 502 bad gateway", 1))).toBeUndefined();
  });

  test("delayMs honors a Retry-After hint (clamped to the maximum)", () => {
    const withHint = mkErr("rate", "API rate limit exceeded\nRetry-After: 2", 1);
    expect(gh.retryPolicy.delayMs(1, withHint)).toBe(2000);
    const hostile = mkErr("rate", "Retry-After: 999999", 1);
    expect(gh.retryPolicy.delayMs(1, hostile)).toBe(MAX_GH_RETRY_AFTER_MS);
  });

  test("delayMs falls back to exponential backoff when no hint is present", () => {
    const noHint = mkErr("rate", "rate limit exceeded", 1);
    expect(gh.retryPolicy.delayMs(1, noHint)).toBe(200);
    expect(gh.retryPolicy.delayMs(2, noHint)).toBe(400);
  });

  test("rate-limit failure with Retry-After is retried then succeeds", async () => {
    const { runner, calls } = fakeRunner([
      { err: mkErr("boom", "API rate limit exceeded\nRetry-After: 2", 1) },
      { ok: { stdout: "ok", stderr: "" } },
    ]);
    const out = await runCapability(
      { ...gh, retryPolicy: { ...gh.retryPolicy, delayMs: () => 0 } },
      { runner, cwd: "/tmp", args: ["issue", "list"] },
    );
    expect(out.stdout).toBe("ok");
    expect(calls.length).toBe(2);
  });

  test("auth error during a list is not retried", async () => {
    const { runner, calls } = fakeRunner([
      { err: mkErr("nope", "HTTP 401: Bad credentials", 1) },
      { ok: { stdout: "should-not-run", stderr: "" } },
    ]);
    await expect(
      runCapability(gh, { runner, cwd: "/tmp", args: ["issue", "list"] }),
    ).rejects.toBeDefined();
    expect(calls.length).toBe(1);
  });
});
