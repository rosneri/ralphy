import type { ChangeStatus } from "@ralphy/change-store";
import type { MetaPromptOptions, TaskPhase } from "./prompt/meta-prompt";

export type { MetaPromptOptions, TaskPhase } from "./prompt/meta-prompt";
export {
  detectEffort,
  resolveEffortOverride,
  EFFORT_GUIDANCE,
  type Effort,
  type DetectEffortOptions,
} from "./prompt/effort";

export type LoopPassType = "normal" | "confirmation" | "ci-fix" | "conflict-resolution";

export interface LoopPreambleContext {
  // Budget state (all required; set cap to 0 for unlimited)
  currentIteration: number;
  maxIterations: number;
  currentCostUsd: number;
  maxCostUsd: number;
  elapsedMinutes: number;
  maxRuntimeMinutes: number;
  // Pass type
  pass: LoopPassType;
  // Confirmation state
  confirmationEnabled: boolean;
  confirmationRound: number;
  // Feature flags
  createPrOnSuccess: boolean;
  stackPrsOnDependencies: boolean;
  syncTasksToComment: boolean;
  // Worktree context
  useWorktree: boolean;
  worktreePath?: string;
  // Issue context
  issueIdentifier?: string;
  issueUrl?: string;
}

// Re-export task utilities with standardized names for use in loop context
export {
  allCompleted as allTasksCompleted,
  countUnchecked as countUncheckedTasks,
  prependSection,
  prependFixTask,
  firstUnchecked as extractFirstUncheckedSection,
  pickActiveTasksFile,
  bothFilesCompleted,
  isFlowTaskHeading,
  FLOW_TASK_HEADING_PREFIXES,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
  HANDOFF_FILENAME,
} from "./tasks-md";

/**
 * Minimal change-store operations required by the loop.
 * Satisfied structurally by ChangeStore from @ralphy/change-store.
 */
export interface LoopChangeStore {
  archiveChange(name: string): Promise<void>;
  /** Optional: if provided, the loop uses this to detect "change archived
   *  externally" (tasks.md missing AND name no longer active) and exit
   *  instead of respawning forever on a no-op iteration. */
  listChanges?(): Promise<string[]>;
  /** Optional: if provided, the loop consults the canonical OpenSpec
   *  artifact status before archiving and refuses to archive while
   *  required artifacts are still pending. */
  getStatus?(name: string): Promise<ChangeStatus>;
}

export interface ReviewRoundResult {
  /** How many open findings the reviewer found. */
  openFindings: number;
  /** Which round number just completed (1-based). */
  roundNumber: number;
  /** Whether the cap was reached after this round. */
  capReached: boolean;
  /** Contents of review-findings.md (for attachment when cap reached). */
  findingsContent: string | null;
}

export interface LoopOptions {
  name: string;
  prompt: string;
  engine: string;
  model: string;
  /** Engine reasoning effort (`claude --effort`). Unset → engine default. */
  effort?: string;
  /** Model / effort for the planning phases (proposal/design/tasks). Unset
   *  falls back to `model` / `effort`. */
  planModel?: string;
  planEffort?: string;
  maxIterations: number;
  maxCostUsd: number;
  maxRuntimeMinutes: number;
  maxConsecutiveFailures: number;
  delay: number;
  log: boolean;
  verbose: boolean;
  manualTest: boolean;
  createPr?: boolean;
  prDraft?: boolean;
  changeStore: LoopChangeStore;
  /** Which prompt-building phase to use. Defaults to "execute". */
  phase?: TaskPhase;
  /** Review phase configuration. When provided and enabled, a fresh reviewer
   *  session is spawned after all tasks complete. */
  reviewPhase?: ReviewPhaseConfig & {
    reviewerModel?: string;
    reviewerEffort?: string;
    reviewerContextStrategy?: "fresh" | "warm";
  };
  /** Called after each review round completes. Use to emit Linear comments. */
  onReviewRound?: (result: ReviewRoundResult) => Promise<void>;
  /** Options for the task-level meta-prompt layer. Pass enabled:false to opt out. */
  metaPrompt?: MetaPromptOptions;
  /** When present, buildLoopLevelPrompt prepends loop/stage/dynamic blocks before the phase prompt. */
  preambleContext?: LoopPreambleContext;
}

export interface ReviewPhaseConfig {
  enabled: boolean;
  maxRounds: number;
}
