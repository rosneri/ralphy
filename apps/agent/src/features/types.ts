/**
 * Feature contract for the per-feature vertical slices that replace the
 * monolithic `coordinator.ts` / `post-task.ts` branching (see
 * `openspec/changes/rlf-94-stage-5-migrate-features-vertically/design.md`).
 *
 * A `Feature` is the only object the coordinator and the post-task
 * dispatcher know about. Each slice owns its detection, its run logic,
 * and at most one top-level slot in `.ralph-state.json`. Cross-feature
 * imports are forbidden by the boundary test under
 * `apps/agent/src/__tests__/feature-boundaries.test.ts`.
 */

import type { Bus } from "@ralphy/events";
import type { TrackedIssue } from "@ralphy/tracker";
import type { PollContext } from "../shared/capabilities/poll-context";

/** Stable id used as the registry key and the bus subsystem prefix. */
export type FeatureId =
  | "confirmation"
  | "conflict-fix"
  | "ci-fix"
  | "awaiting-ci"
  | "implement"
  | "review-followup"
  | "new-ticket"
  | "mention"
  | "stuck";

/**
 * Top-level `.ralph-state.json` slot names a feature can claim.
 *
 * Stage 3's `OWNERSHIP` table in `@ralphy/core/state` is the runtime
 * source of truth. This union mirrors the slots that exist today plus
 * the ones the per-feature slices will introduce in this stage, so the
 * `Feature.ownedSlot` field is statically narrowed and typos surface at
 * compile time instead of at the first failed `writeField` call.
 */
export type StateSlotName =
  | "specAttachments"
  | "linearComments"
  | "confirmation"
  | "review"
  | "ci"
  | "pr"
  | "flow";

/**
 * Narrow write surface a feature receives. Backed by `writeField` from
 * `@ralphy/core/state` so the ownership invariant from Stage 3 is enforced
 * at runtime — calls from the wrong feature throw `OwnershipError` before
 * touching disk.
 */
export interface StateStore {
  /**
   * Write a single field inside this feature's owned slot.
   * `path` is a dotted slot path (e.g. `confirmation.askedAt`).
   */
  writeField(path: string, value: unknown): Promise<void>;
}

/**
 * Bundle of capability handles the coordinator hands to features. Stage 4
 * introduced the capability shell (`shared/capabilities/*`); this type is
 * the aggregate surface a feature is allowed to call. New capabilities
 * land here as additional optional fields so existing slices keep
 * compiling without churn.
 *
 * Fields are intentionally typed as `unknown` for now — concrete handles
 * (gh client, linear client, git runner, etc.) are wired into this bundle
 * by `coordinator.ts` once each slice imports the matching capability
 * directly. Keeping the surface loose at this seam avoids a circular
 * dependency between `features/types.ts` and the capability modules.
 */
/**
 * Per-feature capability bundle for the confirmation slice. Structural
 * shape — defined inline here (not imported from `features/confirmation`)
 * so `features/types.ts` stays free of slice-specific imports and avoids
 * circular references. The slice's own `ConfirmationCaps` interface is
 * assignment-compatible with this shape.
 */
interface ConfirmationCapsShape {
  detect(issue: TrackedIssue): Promise<boolean>;
  run(issue: TrackedIssue): Promise<void>;
}

/**
 * Per-feature capability bundle for the conflict-fix slice. Wire builds
 * the closure once per (issue, poll) so the slice itself stays free of
 * `gh`/git imports. `getMergeability` returns the PR's mergeability
 * state — the slice's `postTask` reports a `failed` event when the PR
 * is conflicting, but does NOT spawn a re-fix loop. Conflict resolution
 * lives inside the worker's AI iteration; this slice is verification
 * only.
 */
interface ConflictFixCapsShape {
  /** Returns "conflicting" when the PR has merge conflicts with its base,
   *  "mergeable" when GitHub considers it clean, "unknown" when GitHub
   *  hasn't computed mergeability yet (or there's no PR to check). */
  getMergeability(): Promise<"mergeable" | "conflicting" | "unknown">;
}

/**
 * Per-feature capability bundle for the ci-fix slice. Wire builds the
 * closure once per (issue, poll) so the slice itself stays free of
 * `gh`/git imports. `getCiStatus` returns the PR's check bucket — the
 * slice's `postTask` records it under `state.ci` and emits an event,
 * but does NOT spawn a re-fix loop. Re-running the worker on failing
 * CI lives in `post-task.ts`'s `fixConflictsAndCiLoop` until the
 * stage-final cleanup moves it here.
 */
interface CiFixCapsShape {
  /** Returns "pass" when all PR checks are green, "fail" when any
   *  non-pending check failed, "pending" when checks are still running,
   *  "unknown" when no PR is known or the gh call failed. */
  getCiStatus(): Promise<"pass" | "fail" | "pending" | "unknown">;
}

/**
 * Per-feature capability bundle for the implement slice. Wire builds the
 * closure once per (issue, poll) so the slice itself stays free of `gh`
 * imports. `getPrUrl` returns the open PR URL associated with the issue's
 * branch (or `null` when no PR is known yet). The slice's `postTask`
 * records the URL under `state.pr` and emits an event — the push +
 * hook-fix retry loop lives in `post-task.ts` until the stage-final
 * cleanup moves it here.
 */
interface ImplementCapsShape {
  /** Returns the PR URL associated with the issue's branch, or `null`
   *  when no PR exists yet (branch never pushed, gh call failed, etc.). */
  getPrUrl(): Promise<string | null>;
}

export interface Capabilities {
  /** GitHub REST/CLI capability (PR data, mergeability, reviews). */
  gh: unknown;
  /** Linear capability (issues, comments, attachments, labels). */
  linear: unknown;
  /** Git capability (worktrees, branches, push, status). */
  git: unknown;
  /** Filesystem capability for `openspec/changes/<name>` writes. */
  fsChange: unknown;
  /** Worker spawner capability (subprocess + JSON event stream). */
  worker: unknown;
  /** Confirmation slice closure bundle, wired by the agent's `wire.ts`.
   *  Optional so test contexts that don't exercise the confirmation
   *  feature can omit it without satisfying every closure. */
  confirmation?: ConfirmationCapsShape;
  /** Conflict-fix slice closure bundle, wired by the agent's `wire.ts`.
   *  Optional so test contexts that don't exercise the conflict-fix
   *  feature can omit it without satisfying the mergeability check. */
  conflictFix?: ConflictFixCapsShape;
  /** CI-fix slice closure bundle, wired by the agent's `wire.ts`.
   *  Optional so test contexts that don't exercise the ci-fix feature
   *  can omit it without satisfying the gh-checks closure. */
  ciFix?: CiFixCapsShape;
  /** Implement slice closure bundle, wired by the agent's `wire.ts`.
   *  Optional so test contexts that don't exercise the implement feature
   *  can omit it without satisfying the gh-pr-lookup closure. */
  implement?: ImplementCapsShape;
}

/** Shared context passed to every `Feature.detect` and `Feature.run`. */
export interface FeatureCtx {
  /** Linear issue this poll is acting on. */
  issue: TrackedIssue;
  /** Absolute path to the issue's worktree (or projectRoot when worktrees off). */
  worktree: string;
  /** Single-writer slot accessor for `.ralph-state.json` (Stage 3). */
  state: StateStore;
  /** Event bus (Stage 1). Features emit `feature.<id>.*` events through it. */
  bus: Bus;
  /** Bundled capability handles (Stage 4). */
  caps: Capabilities;
  /** Per-poll memo (Stage 3) — caches expensive fetches across detectors. */
  poll: PollContext;
  /** Injected clock so tests can pin "now". */
  now: () => Date;
}

/** What a feature returns from `detect` when it wants to run this poll. */
export interface FeatureMatch {
  /** Human-readable reason for the match. Surfaced in `feature.<id>.detected`. */
  reason: string;
}

/**
 * Minimal worker-task result handed to per-feature `postTask` hooks.
 *
 * Kept intentionally small — slices that need more (push status, pr url,
 * etc.) can read them from `FeatureCtx.state` or extend this type
 * additively without breaking existing slices.
 */
export interface TaskResult {
  /** Exit code from the worker subprocess. */
  exitCode: number;
  /** Branch the worker committed to, when known. */
  branch: string | null;
}

/** The feature contract: detection, run, optional post-task tail. */
export interface Feature {
  /** Stable id — bus subsystem prefix and registry key. */
  id: FeatureId;
  /** Which top-level `.ralph-state.json` slot this feature owns. */
  ownedSlot: StateSlotName | null;
  /** Returns a match when this feature wants this poll, else `null`. */
  detect(ctx: FeatureCtx): Promise<FeatureMatch | null>;
  /** Run the feature for this poll. Throws are caught by `runFeature`. */
  run(ctx: FeatureCtx, match: FeatureMatch): Promise<void>;
  /** Optional post-task hook invoked by `post-task.ts` dispatch. */
  postTask?(ctx: FeatureCtx, result: TaskResult): Promise<void>;
}
