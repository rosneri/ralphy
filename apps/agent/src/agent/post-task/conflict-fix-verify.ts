import type { CmdRunner } from "../pr";
import { fetchPrStatus, type PrStatus } from "../../pr-status";
import { waitForMergeability } from "../../shared/pr/wait-for-mergeability";
import { findExistingOpenPrUrl } from "./pr-phase";
import { PR_FAILED_EXIT, type PostTaskPhase } from "./types";

/** Inputs consumed only by the conflict-fix verify phase. */
interface ConflictFixVerifyInput {
  /** Human-readable label for logs — the issue identifier or change name. */
  identifier: string;
  cwd: string;
  branch: string | null;
  /** Pre-resolved PR URL (from the wire layer's per-change cache), or null. */
  prUrl: string | null;
}

/** Deps consumed only by the conflict-fix verify phase. */
interface ConflictFixVerifyDeps {
  cmd: CmdRunner;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  /** Override the UNKNOWN-mergeability polling backoff schedule (ms). */
  mergeabilityBackoffsMs?: number[];
}

/**
 * RLF-82: conflict-fix verify-only short-circuit. The worker iteration owns the
 * push (see `wire/prepare.ts::prepareTaskForTrigger`), so this phase never
 * invokes `git push` or `createPrWithRetry`. It only verifies the PR's current
 * mergeability via a single `fetchPrStatus` call and reacts to the outcome
 * (clearConflicted on MERGEABLE; leave the label in place otherwise).
 *
 * Returns `0` when the verification ran (mergeable, conflicting, unknown, or
 * fetch error are all "checked, will re-poll" outcomes — `emit("done")`), and
 * `PR_FAILED_EXIT` when the worker left an unpushed resolution (`emit("gave-up")`)
 * so the iteration is retried instead of falsely reported as resolved.
 */
export async function runConflictFixVerify(
  input: ConflictFixVerifyInput,
  deps: ConflictFixVerifyDeps,
): Promise<number> {
  const { identifier, cwd, branch, prUrl: prefetchedPrUrl } = input;
  const { cmd, log, emit } = deps;

  // Push-landed guard. In conflict-fix mode the worker owns the push (see
  // `wire/prepare.ts::prepareTaskForTrigger`); the harness never pushes here.
  // If the worker resolved + committed but never pushed (or the push silently
  // failed), the local branch is ahead of `origin/<branch>` while the PR head
  // stays frozen. The mergeability probe below only inspects GitHub's view of
  // the *remote* head, so it would report this iteration a success, the
  // coordinator would post "resolved merge conflicts", and the next poll would
  // re-detect the same CONFLICTING PR — burning recovery attempts until the
  // PR-tracker bails to `ralph:error`, then looping forever. Detect the
  // unpushed divergence and fail the iteration so the "resolved" signal is
  // honest. (The remote-tracking ref is updated by a successful push, so this
  // needs no fetch.)
  if (branch) {
    let aheadCount = 0;
    let checked = true;
    try {
      const r = await cmd.run(["git", "rev-list", "--count", `origin/${branch}..HEAD`], cwd);
      aheadCount = Number.parseInt(r.stdout.trim(), 10) || 0;
    } catch (err) {
      // Ref missing / detached HEAD / not a worktree — can't determine, so
      // don't block: fall through to the existing mergeability verification.
      checked = false;
      log(
        `! ${identifier}: could not check for unpushed conflict-fix commits: ${(err as Error).message}`,
        "yellow",
      );
    }
    if (checked && aheadCount > 0) {
      log(
        `! ${identifier}: conflict-fix worker left ${aheadCount} unpushed commit(s) ahead of ` +
          `origin/${branch} — the resolution never reached the PR. Failing the iteration so it ` +
          `is retried instead of reported as resolved.`,
        "red",
      );
      emit("gave-up", "unpushed conflict resolution");
      // Fail the iteration; the caller's single `finally` preserves the
      // worktree because the returned code is non-zero.
      return PR_FAILED_EXIT;
    }
  }

  let prUrl: string | null = prefetchedPrUrl;
  if (!prUrl && branch) {
    prUrl = await findExistingOpenPrUrl(cmd, cwd, branch);
  }
  if (!prUrl) {
    log(
      `  ${identifier}: no open PR found for conflict-fix verification — nothing to verify`,
      "yellow",
    );
  } else {
    // Widen to the union explicitly — TS narrows from the initial
    // assignment and otherwise won't see closure mutations inside `probe`.
    let status: PrStatus = { kind: "error", message: "no probe ran" } as PrStatus;
    const outcome = await waitForMergeability({
      ...(deps.mergeabilityBackoffsMs !== undefined
        ? { backoffsMs: deps.mergeabilityBackoffsMs }
        : {}),
      bailOnError: true,
      probe: async () => {
        status = await fetchPrStatus(prUrl, cmd, cwd);
        if (status.kind === "error") throw new Error(status.message);
        return { state: status.state, mergeable: status.mergeable };
      },
    });
    // Synthesize a `status` for the log decision below from the outcome.
    // `status` closes over each probe attempt's result; `outcome` adds
    // the post-loop decision (e.g. mergeStateStatus=CLEAN can flip
    // mergeable=UNKNOWN to "mergeable"), so reconcile the two here.
    if (outcome.kind === "error") {
      status = { kind: "error", message: outcome.message };
    } else if (status.kind === "ok") {
      if (outcome.kind === "mergeable") {
        status = { ...status, mergeable: "MERGEABLE" };
      } else if (outcome.kind === "conflicting") {
        status = { ...status, mergeable: "CONFLICTING" };
      }
      // outcome.kind === "closed" or "unknown" → leave mergeable as-is
      // so the "still UNKNOWN" log fires.
    }
    if (status.kind === "ok" && status.mergeable === "MERGEABLE") {
      log(`  ${identifier}: PR ${prUrl} is MERGEABLE after rebase`, "green");
    } else if (status.kind === "ok" && status.mergeable === "CONFLICTING") {
      log(`! ${identifier}: still CONFLICTING after rebase; will retry`, "yellow");
    } else if (status.kind === "ok") {
      log(
        `! ${identifier}: PR mergeability is UNKNOWN — next poll will re-check from GitHub`,
        "yellow",
      );
    } else {
      log(
        `! ${identifier}: PR status fetch failed (${status.message}) — next poll will re-check`,
        "yellow",
      );
    }
  }
  emit("done");
  return 0;
}
