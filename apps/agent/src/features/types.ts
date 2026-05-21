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
import type { LinearIssue } from "../agent/linear";
import type { PollContext } from "../shared/capabilities/poll-context";

/** Stable id used as the registry key and the bus subsystem prefix. */
export type FeatureId =
  | "confirmation"
  | "conflict-fix"
  | "ci-fix"
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
  | "pr";

export type StateSlotMap = Record<StateSlotName, true>;

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
export interface ConfirmationCapsShape {
  detect(issue: LinearIssue): Promise<boolean>;
  run(issue: LinearIssue): Promise<void>;
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
}

/** Shared context passed to every `Feature.detect` and `Feature.run`. */
export interface FeatureCtx {
  /** Linear issue this poll is acting on. */
  issue: LinearIssue;
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
