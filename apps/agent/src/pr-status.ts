import type { CmdRunner } from "./agent/pr";

export type CiBucket = "pass" | "fail" | "pending";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PrStatusOk {
  kind: "ok";
  state: PrState;
  isDraft: boolean;
  mergeable: Mergeable;
  ciBucket: CiBucket;
  autoMergeEnabled: boolean;
  createdAt: string;
}

export interface PrStatusError {
  kind: "error";
  message: string;
}

export type PrStatus = PrStatusOk | PrStatusError;

const PR_VIEW_FIELDS = "state,isDraft,mergeable,statusCheckRollup,autoMergeRequest,createdAt";

interface RawCheck {
  status?: string;
  conclusion?: string;
  state?: string;
}

/**
 * Map a `gh pr view --json statusCheckRollup` array into our 3-bucket model.
 * Mirrors the bucketing in `agent/ci.ts::getPrChecksStatus` but works off the
 * `statusCheckRollup` shape returned by `gh pr view` (rather than `gh pr checks`).
 */
function bucketChecks(rollup: RawCheck[] | null | undefined, prState: PrState): CiBucket {
  if (rollup === null || rollup === undefined || rollup.length === 0) {
    return prState === "MERGED" ? "pass" : "pending";
  }
  let anyPending = false;
  let anyFail = false;
  for (const c of rollup) {
    // GitHub Actions checks: { status: "COMPLETED", conclusion: "SUCCESS"|"FAILURE"|... }
    // Legacy commit statuses: { state: "SUCCESS"|"FAILURE"|"PENDING" }
    const status = (c.status ?? "").toUpperCase();
    const conclusion = (c.conclusion ?? "").toUpperCase();
    const state = (c.state ?? "").toUpperCase();
    if (status && status !== "COMPLETED") {
      anyPending = true;
      continue;
    }
    if (state === "PENDING" || state === "EXPECTED") {
      anyPending = true;
      continue;
    }
    const settled = conclusion || state;
    if (
      settled === "FAILURE" ||
      settled === "TIMED_OUT" ||
      settled === "CANCELLED" ||
      settled === "ERROR"
    ) {
      anyFail = true;
    }
    // SUCCESS / NEUTRAL / SKIPPED — treat as pass
  }
  if (anyPending) return "pending";
  if (anyFail) return "fail";
  return "pass";
}

interface RawPrView {
  state?: string;
  isDraft?: boolean;
  mergeable?: string;
  statusCheckRollup?: RawCheck[] | null;
  autoMergeRequest?: unknown;
  createdAt?: string;
}

/**
 * Optional transition hook passed by callers that maintain their own
 * per-issue PR-URL cache (see `pr-url.ts::createPrUrlCache`). When the
 * fetched PR state differs from `priorState`, `onTransition` fires so
 * the caller can invalidate the cached URL — the canonical trigger for
 * re-resolving the PR URL on the next poll.
 */
interface PrStatusTransitionHook {
  priorState?: PrState | null;
  onTransition: (next: PrState) => void;
}

/**
 * Fetch a PR's status via `gh pr view`. Returns `{ kind: "error" }` on any
 * failure (network, auth, malformed JSON) so a single bad PR doesn't break
 * the unified `agent list` table.
 *
 * When `transition` is supplied and the fetched state differs from
 * `transition.priorState`, `transition.onTransition(next)` fires.
 */
export async function fetchPrStatus(
  url: string,
  runner: CmdRunner,
  cwd: string,
  transition?: PrStatusTransitionHook,
): Promise<PrStatus> {
  let stdout: string;
  try {
    const out = await runner.run(["gh", "pr", "view", url, "--json", PR_VIEW_FIELDS], cwd);
    stdout = out.stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    const msg = (e.stderr?.trim().split("\n")[0] ?? e.message ?? "gh failed").slice(0, 200);
    return { kind: "error", message: msg };
  }
  let raw: RawPrView;
  try {
    raw = JSON.parse(stdout || "{}") as RawPrView;
  } catch (err) {
    return { kind: "error", message: `parse error: ${(err as Error).message}` };
  }
  const stateUpper = (raw.state ?? "").toUpperCase();
  const state: PrState =
    stateUpper === "OPEN" || stateUpper === "CLOSED" || stateUpper === "MERGED"
      ? stateUpper
      : "OPEN";
  const mergeableUpper = (raw.mergeable ?? "UNKNOWN").toUpperCase();
  const mergeable: Mergeable =
    mergeableUpper === "MERGEABLE" || mergeableUpper === "CONFLICTING" ? mergeableUpper : "UNKNOWN";
  if (transition && transition.priorState !== state) {
    transition.onTransition(state);
  }
  return {
    kind: "ok",
    state,
    isDraft: Boolean(raw.isDraft),
    mergeable,
    ciBucket: bucketChecks(raw.statusCheckRollup, state),
    autoMergeEnabled: raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined,
    createdAt: raw.createdAt ?? "",
  };
}
