import {
  classifyGhBucket,
  NO_CHECKS_RE,
  PARTIAL_ACCESS_RE,
  reduceToBucket,
  runGhWithRetry,
} from "./ci-classify";
import type {
  CiStatus,
  CmdRunner,
  CodeHost,
  CreatePullRequestOptions,
  MergeStrategy,
  PullRequestDetails,
  PullRequestState,
} from "./types";

const PR_CHECKS_FIELDS = "name,bucket,link,workflow,event";

/** Normalize GitHub's uppercase `state` (OPEN/MERGED/CLOSED) to the port's
 *  lowercase {@link PullRequestState}; anything unrecognized is treated as open. */
function normalizeState(raw: string | undefined): PullRequestState {
  const state = raw?.toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

interface GhCheck {
  name: string;
  bucket: string;
  link?: string;
}

/** Safely parse the `gh pr checks --json` array; returns [] on empty/malformed
 *  output so a partial-success blob can be probed without throwing. */
function parseChecks(stdout: string | undefined): GhCheck[] {
  try {
    const parsed = JSON.parse(stdout || "[]");
    return Array.isArray(parsed) ? (parsed as GhCheck[]) : [];
  } catch {
    return [];
  }
}

/** Matches a canonical GitHub PR URL and captures `owner`/`repo`. */
const REPO_FROM_PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/;

/**
 * The shared idempotency query: the URL of the open PR whose head is `branch`,
 * or null when none is open. Used both by {@link openPullRequest} (which lets a
 * `gh` failure propagate) and the port's {@link CodeHost.findOpenPullRequestForBranch}
 * (which swallows failures to null). Single source so the two never drift.
 */
async function queryOpenPrUrl(
  runner: CmdRunner,
  cwd: string,
  branch: string,
): Promise<string | null> {
  const { stdout } = await runner.run(
    [
      "gh",
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
    ],
    cwd,
  );
  return stdout.trim() || null;
}

export interface GhCliCodeHostInput {
  cmdRunner: CmdRunner;
  /** Default cwd for every `gh`/`git` invocation (usually the project root). */
  cwd: string;
  /** CI check names ignored when judging a PR green. */
  ignoreChecks?: string[];
  /** Surfaced when a transient `gh` failure is retried with backoff. */
  onTransientRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

/**
 * Attach labels to an existing PR, best-effort. Labels are PR decoration, not
 * part of the valuable artifact (the PR itself), so a failure here — a missing
 * label, a permissions issue, an offline `gh` — must never propagate and fail
 * PR creation. Empty/blank entries are filtered so a stray `[""]` never
 * produces `--add-label ""`.
 */
async function applyLabels(
  runner: CmdRunner,
  cwd: string,
  prRef: string,
  labels: readonly string[],
): Promise<void> {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0 || !prRef) return;
  try {
    await runner.run(["gh", "pr", "edit", prRef, "--add-label", clean.join(",")], cwd);
  } catch {
    // Best-effort: the PR is the artifact, labels are metadata.
  }
}

/**
 * Push the branch and open (or surface) a GitHub PR — the one shared PR-create
 * mechanism. Idempotent: when an open PR already exists for the branch, its
 * URL is returned with `created: false` (labels are still applied). The
 * {@link CodeHost.createPullRequest} port method wraps this; callers that need
 * the created/existing distinction (e.g. the agent's post-task log line) use
 * it directly.
 */
export async function openPullRequest(
  cmdRunner: CmdRunner,
  cwd: string,
  options: CreatePullRequestOptions,
): Promise<{ url: string; created: boolean }> {
  const runCwd = options.cwd ?? cwd;

  // Push the branch (idempotent with -u).
  await cmdRunner.run(["git", "push", "-u", "origin", options.branch], runCwd);

  // If a PR already exists for this branch, just return its URL.
  const existingUrl = await queryOpenPrUrl(cmdRunner, runCwd, options.branch);
  if (existingUrl) {
    await applyLabels(cmdRunner, runCwd, existingUrl, options.labels ?? []);
    return { url: existingUrl, created: false };
  }

  const createArgs = [
    "gh",
    "pr",
    "create",
    "--base",
    options.base,
    "--title",
    options.title,
    "--body",
    options.body,
  ];
  if (options.draft) createArgs.push("--draft");
  const created = await cmdRunner.run(createArgs, runCwd);
  const url = created.stdout.trim().split("\n").pop() ?? "";
  await applyLabels(cmdRunner, runCwd, url, options.labels ?? []);
  return { url, created: true };
}

/**
 * The `gh`-CLI {@link CodeHost} adapter — the single place PR mechanism
 * touches the CLI. All IO flows through the injected {@link CmdRunner}, so the
 * adapter is fully scriptable in tests (per repo convention: scripted runners,
 * never `mock.module`).
 */
export function createGhCliCodeHost(input: GhCliCodeHostInput): CodeHost {
  const { cmdRunner, cwd } = input;
  const ignoredLower = (input.ignoreChecks ?? []).map((n) => n.toLowerCase());
  // Per-repo auto-merge capability, cached for this adapter's lifetime (the
  // single coordinator instance) so a multi-PR run probes each repo once.
  const autoMergeCache = new Map<string, boolean | null>();

  return {
    async getPullRequestState(url: string): Promise<PullRequestState> {
      const { stdout } = await cmdRunner.run(["gh", "pr", "view", url, "--json", "state"], cwd);
      return normalizeState((JSON.parse(stdout.trim() || "{}") as { state?: string }).state);
    },

    async getPullRequestDetails(url: string): Promise<PullRequestDetails> {
      const { stdout } = await cmdRunner.run(
        ["gh", "pr", "view", url, "--json", "state,headRefName,title,url"],
        cwd,
      );
      const parsed = JSON.parse(stdout.trim() || "{}") as {
        state?: string;
        headRefName?: string;
        title?: string;
        url?: string;
      };
      return {
        state: normalizeState(parsed.state),
        headRefName: parsed.headRefName ?? "",
        title: parsed.title ?? "",
        url: parsed.url ?? url,
      };
    },

    /**
     * Resolve the status of a PR's CI checks.
     *
     * - "pending" if any check is still in progress
     * - "fail"    if every non-pending check has settled and at least one failed
     * - "pass"    if every check passed
     *
     * `failedRunIds` extracts numeric workflow-run IDs from each failing
     * check's `link` field. Transient HTTP 5xx / network failures from `gh`
     * are retried with backoff (5s/15s/45s); "no checks reported" is a pass;
     * a PARTIAL-access error blob with salvageable JSON is salvaged.
     */
    async getChecksStatus(prRef: string): Promise<CiStatus> {
      let out: { stdout: string; stderr: string };
      try {
        out = await runGhWithRetry(
          ["gh", "pr", "checks", prRef, "--json", PR_CHECKS_FIELDS],
          cmdRunner,
          cwd,
          input.onTransientRetry,
        );
      } catch (err) {
        const e = err as Error & { stderr?: string; stdout?: string };
        const blob = `${e.message}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`;
        if (NO_CHECKS_RE.test(blob))
          return { bucket: "pass", failedRunIds: [], failedCheckNames: [] };
        if (PARTIAL_ACCESS_RE.test(blob) && parseChecks(e.stdout).length > 0) {
          out = { stdout: e.stdout!, stderr: e.stderr ?? "" };
        } else {
          throw err;
        }
      }
      const checks = parseChecks(out.stdout).filter(
        (c) => !ignoredLower.includes(c.name.toLowerCase()),
      );
      const bucket = reduceToBucket(checks.map((c) => classifyGhBucket(c.bucket)));
      if (bucket !== "fail") return { bucket, failedRunIds: [], failedCheckNames: [] };

      const failed = checks.filter((c) => classifyGhBucket(c.bucket) === "fail");
      const ids = new Set<string>();
      for (const c of failed) {
        const m = c.link?.match(/\/actions\/runs\/(\d+)/);
        if (m) ids.add(m[1]!);
      }
      return {
        bucket: "fail",
        failedRunIds: [...ids],
        failedCheckNames: failed.map((c) => c.name),
      };
    },

    async createPullRequest(options: CreatePullRequestOptions): Promise<string> {
      const { url } = await openPullRequest(cmdRunner, cwd, options);
      return url;
    },

    async findOpenPullRequestForBranch(branch: string): Promise<string | null> {
      // Best-effort: a transient gh failure must not escalate — callers fall
      // back (e.g. to the uncommitted-changes warning) rather than error out.
      try {
        return await queryOpenPrUrl(cmdRunner, cwd, branch);
      } catch {
        return null;
      }
    },

    async isAutoMergeAllowed(prUrl: string): Promise<boolean | null> {
      const m = REPO_FROM_PR_URL.exec(prUrl);
      if (!m) return null;
      const repoKey = `${m[1]}/${m[2]}`;
      if (autoMergeCache.has(repoKey)) return autoMergeCache.get(repoKey) ?? null;
      let result: boolean | null;
      try {
        const { stdout } = await cmdRunner.run(
          ["gh", "api", `repos/${repoKey}`, "--jq", ".allow_auto_merge"],
          cwd,
        );
        const out = stdout.trim().toLowerCase();
        result = out === "true" ? true : out === "false" ? false : null;
      } catch {
        // Undeterminable (gh failure / offline) — cache null so we neither
        // re-probe nor regress repos where the API call fails for unrelated
        // reasons; the caller assumes enabled.
        result = null;
      }
      autoMergeCache.set(repoKey, result);
      return result;
    },

    async markReady(url: string): Promise<void> {
      await cmdRunner.run(["gh", "pr", "ready", url], cwd);
    },

    async enableAutoMerge(url: string, strategy: MergeStrategy): Promise<void> {
      await cmdRunner.run(["gh", "pr", "merge", url, "--auto", `--${strategy}`], cwd);
    },

    async merge(url: string, strategy: MergeStrategy): Promise<void> {
      await cmdRunner.run(["gh", "pr", "merge", url, `--${strategy}`], cwd);
    },
  };
}
