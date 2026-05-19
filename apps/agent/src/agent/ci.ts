import type { CmdRunner } from "./pr";

export interface CiStatus {
  bucket: "pass" | "fail" | "pending";
  /** Workflow run IDs of failing checks (only populated when bucket is "fail"). */
  failedRunIds: string[];
}

const PR_CHECKS_FIELDS = "name,bucket,link,workflow,event";

const TRANSIENT_GH_RE =
  /HTTP 5\d\d|Gateway Timeout|Bad Gateway|Service Unavailable|connection reset|ECONNRESET|ETIMEDOUT|getaddrinfo|EAI_AGAIN|could not resolve host/i;

/** gh exits 1 with this message when no workflows are configured for a branch. */
const NO_CHECKS_RE = /no checks reported/i;

/** Backoff schedule for transient `gh` failures (ms). 5s / 15s / 45s. */
const GH_RETRY_DELAYS = [5_000, 15_000, 45_000];

/** Internal: run gh with retry on transient HTTP/network errors. */
async function runGhWithRetry(
  cmd: string[],
  runner: CmdRunner,
  cwd: string,
  onRetry?: (attempt: number, delayMs: number, reason: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ stdout: string; stderr: string }> {
  let lastErr: unknown;
  for (let i = 0; i <= GH_RETRY_DELAYS.length; i++) {
    try {
      return await runner.run(cmd, cwd);
    } catch (err) {
      const e = err as Error & { stderr?: string; stdout?: string };
      const blob = `${e.message}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`;
      if (!TRANSIENT_GH_RE.test(blob) || i === GH_RETRY_DELAYS.length) throw err;
      const delay = GH_RETRY_DELAYS[i]!;
      const firstLine = (e.stderr?.trim().split("\n")[0] ?? e.message).slice(0, 120);
      onRetry?.(i + 1, delay, firstLine);
      await sleep(delay);
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Resolve the status of a PR's CI checks.
 *
 * - "pending" if any check is still in progress
 * - "fail"    if every non-pending check has settled and at least one failed
 * - "pass"    if every check passed
 *
 * `failedRunIds` extracts numeric workflow-run IDs from each failing
 * check's `link` field (e.g. ".../actions/runs/12345/job/9876" → "12345").
 *
 * Transient HTTP 5xx / network failures from `gh` are retried with
 * backoff (5s/15s/45s) — a single GitHub blip should not abort the
 * watch loop.
 */
export async function getPrChecksStatus(
  prRef: string,
  runner: CmdRunner,
  cwd: string,
  onTransientRetry?: (attempt: number, delayMs: number, reason: string) => void,
  ignoreCiChecks: string[] = [],
): Promise<CiStatus> {
  let out: { stdout: string; stderr: string };
  try {
    out = await runGhWithRetry(
      ["gh", "pr", "checks", prRef, "--json", PR_CHECKS_FIELDS],
      runner,
      cwd,
      onTransientRetry,
    );
  } catch (err) {
    const e = err as Error & { stderr?: string; stdout?: string };
    const blob = `${e.message}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`;
    // gh exits 1 with "no checks reported" when the repo has no CI workflows.
    // Treat this as a pass — no checks configured means nothing can fail.
    if (NO_CHECKS_RE.test(blob)) return { bucket: "pass", failedRunIds: [] };
    throw err;
  }
  const ignoredLower = ignoreCiChecks.map((n) => n.toLowerCase());
  const checks = (
    JSON.parse(out.stdout || "[]") as {
      name: string;
      bucket: string;
      link?: string;
    }[]
  )
    .filter((c) => !ignoredLower.includes(c.name.toLowerCase()))
    .filter((c) => c.bucket !== "skipping");

  if (checks.some((c) => c.bucket === "pending")) {
    return { bucket: "pending", failedRunIds: [] };
  }
  const failed = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failed.length === 0) return { bucket: "pass", failedRunIds: [] };

  const ids = new Set<string>();
  for (const c of failed) {
    const m = c.link?.match(/\/actions\/runs\/(\d+)/);
    if (m) ids.add(m[1]!);
  }
  return { bucket: "fail", failedRunIds: [...ids] };
}

/** Fetch the failure logs for a set of workflow runs, truncated. */
export async function fetchFailedRunLogs(
  runIds: string[],
  runner: CmdRunner,
  cwd: string,
  maxCharsPerRun = 4000,
): Promise<string> {
  const chunks: string[] = [];
  for (const id of runIds) {
    try {
      const r = await runner.run(["gh", "run", "view", id, "--log-failed"], cwd);
      const text = r.stdout.trim();
      const truncated =
        text.length > maxCharsPerRun
          ? text.slice(0, maxCharsPerRun) + `\n…[truncated ${text.length - maxCharsPerRun} chars]`
          : text;
      chunks.push(`--- run ${id} ---\n${truncated}`);
    } catch (err) {
      chunks.push(`--- run ${id} ---\n(failed to fetch logs: ${(err as Error).message})`);
    }
  }
  return chunks.join("\n\n");
}

export interface CiFixDeps {
  getStatus: () => Promise<CiStatus>;
  getFailedLogs: (runIds: string[]) => Promise<string>;
  /** Append a steering message + re-spawn the task loop. Resolves with the
   *  worker's exit code. The worker is expected to commit any fixes. */
  runTaskWithSteering: (steering: string) => Promise<number>;
  /** Push the worker's branch so CI re-runs on the PR. */
  pushBranch: () => Promise<void>;
  /** Optional: return the current HEAD SHA. When provided, the fix loop
   *  bails after a worker turn that produced no new commits — there is
   *  nothing to push, so re-pushing and re-polling cannot change CI
   *  status. This typically means the failure is external (Vercel rate
   *  limit, infra outage, account block) and not fixable by re-running
   *  the worker. */
  getHeadSha?: () => Promise<string>;
  log: (text: string, color?: string) => void;
  /** Sleep helper (injected for testability). Returns when timer elapses. */
  sleep: (ms: number) => Promise<void>;
  /** Returns true if the loop should bail early (e.g. SIGINT). */
  cancelled?: () => boolean;
  /** Optional phase emitter — caller may surface "ci-poll" / "ci-fix" / etc. */
  onPhase?: (phase: string, detail?: string) => void;
}

interface CiFixOptions {
  maxAttempts: number;
  pollIntervalSeconds: number;
}

interface CiFixResult {
  success: boolean;
  attempts: number;
  reason?: string;
}

async function safeSha(getHeadSha: () => Promise<string>): Promise<string | null> {
  try {
    const sha = (await getHeadSha()).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Loop "wait for CI → if failed, feed logs back as steering and re-run the
 * task → push" until checks pass, max attempts is hit, or the caller
 * cancels.
 */
export async function fixCiUntilGreen(deps: CiFixDeps, opts: CiFixOptions): Promise<CiFixResult> {
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    let pollN = 0;
    // Wait until checks have settled (pass or fail).
    while (true) {
      if (deps.cancelled?.()) return { success: false, attempts: attempt - 1, reason: "cancelled" };
      pollN += 1;
      deps.onPhase?.("ci-poll", `attempt ${attempt}/${opts.maxAttempts} · poll ${pollN}`);
      let s: CiStatus;
      try {
        s = await deps.getStatus();
      } catch (err) {
        deps.log(
          `! gh pr checks failed permanently: ${(err as Error).message} — giving up CI watch`,
          "red",
        );
        return { success: false, attempts: attempt - 1, reason: "gh-failed" };
      }
      if (s.bucket === "pass") {
        deps.log(`✓ CI green for PR (after ${attempt - 1} fix attempts)`, "green");
        return { success: true, attempts: attempt - 1 };
      }
      if (s.bucket === "fail") {
        deps.log(
          `✗ CI failing (attempt ${attempt}/${opts.maxAttempts}) — fetching logs and re-running task`,
          "yellow",
        );
        deps.onPhase?.("ci-fix", `attempt ${attempt}/${opts.maxAttempts} · fetching logs`);
        const logs = await deps.getFailedLogs(s.failedRunIds);
        deps.onPhase?.("ci-fix", `attempt ${attempt}/${opts.maxAttempts} · re-running worker`);
        const steering = `CI is failing on this PR. Investigate and fix:\n\n\`\`\`\n${logs}\n\`\`\``;
        const shaBefore = deps.getHeadSha ? await safeSha(deps.getHeadSha) : null;
        const code = await deps.runTaskWithSteering(steering);
        if (code !== 0) {
          deps.log(`! task loop exited code ${code} during CI fix attempt ${attempt}`, "red");
        }
        // No-progress guard: if the worker produced no new commits, pushing
        // and re-polling cannot change CI. Bail out so the supervisor can
        // mark the issue as CI-failed and move on to other work, instead of
        // burning the full maxAttempts budget on something the worker
        // already decided it cannot fix.
        if (shaBefore !== null) {
          const shaAfter = await safeSha(deps.getHeadSha!);
          if (shaAfter !== null && shaAfter === shaBefore) {
            deps.log(
              `! worker produced no new commits on CI fix attempt ${attempt} — failure looks external (e.g. rate-limited deploy). Giving up CI watch.`,
              "yellow",
            );
            return { success: false, attempts: attempt, reason: "no-progress" };
          }
        }
        try {
          deps.onPhase?.("ci-fix", `attempt ${attempt}/${opts.maxAttempts} · pushing fix`);
          await deps.pushBranch();
        } catch (err) {
          deps.log(`! push failed during CI fix: ${(err as Error).message}`, "red");
          return { success: false, attempts: attempt, reason: "push-failed" };
        }
        // After pushing, break the inner wait loop and start the next attempt
        // (which will re-poll the new check run).
        break;
      }
      // pending — wait and re-check
      deps.onPhase?.("ci-poll", `attempt ${attempt}/${opts.maxAttempts} · pending, waiting`);
      await deps.sleep(opts.pollIntervalSeconds * 1000);
    }
  }
  return { success: false, attempts: opts.maxAttempts, reason: "max-attempts" };
}
