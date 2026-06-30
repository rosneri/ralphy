/** Coordinator/worker contracts the AgentMode TUI depends on, plus the default
 *  steering-append helper. Kept separate so tests can import the structural
 *  types without pulling in the React render. */

import type { ActiveWorker, PauseState, PollResult } from "../../agent/coordinator";
import { buildAgentCoordinator as buildAgentCoordinatorImpl } from "../../agent/wire";
import type { OpenSpecPhase } from "@ralphy/core/openspec-phase";
import { appendSteeringMessage } from "@ralphy/core/loop/stop-and-state";
import { runWithContext, createDefaultContext } from "@ralphy/context";

/** Structural subset of {@link AgentCoordinator} that AgentMode actually uses.
 * Exported so tests can supply lightweight mocks without bypassing types. */
export interface AgentModeCoordinator {
  init(): Promise<void>;
  pollOnce(): Promise<PollResult>;
  stop(): void;
  readonly activeWorkers: readonly ActiveWorker[];
  readonly activeCount: number;
  readonly queuedCount: number;
  getPause(): PauseState | null;
  restartWorker(changeName: string): Promise<boolean>;
  notifySteeringAppended?(changeName: string, message: string): Promise<void>;
}

/** Builder function shape the AgentMode component depends on. The real
 *  {@link buildAgentCoordinatorImpl} satisfies this because `AgentCoordinator`
 *  is assignable to {@link AgentModeCoordinator}. */
export type AgentModeBuildCoordinator = (
  input: Parameters<typeof buildAgentCoordinatorImpl>[0],
) => {
  coord: AgentModeCoordinator;
  filterDesc: string;
  concurrency: number;
  pollInterval: number;
  getWorkerCwd: (changeName: string) => string | undefined;
  runBaselineGate: () => Promise<void>;
};

export interface WorkerMeta {
  startedAt: number;
  statesDir: string;
  logFile: string;
  changeDir: string;
  iter: number;
  phase: string;
  phaseDetail: string;
  phaseStartedAt: number;
  currentTask: string | null;
  subtasks: Array<{ done: boolean; text: string }>;
  taskProgress: { checked: number; total: number } | null;
  openspecPhase: OpenSpecPhase | null;
  reviewRounds: number;
  prUrl: string | null;
  currentCmd: { argv: string[]; startedAt: number } | null;
  tail: string[];
}

/**
 * Append a steering message to a change's steering.md, wrapped in a default
 * context so the underlying storage helpers in `@ralphy/core` have an active
 * AsyncLocalStorage scope (mirroring the sidecar's `/steer` route).
 */
export async function appendSteeringImpl(changeDir: string, message: string): Promise<void> {
  await runWithContext(createDefaultContext(), async () => {
    appendSteeringMessage(changeDir, message);
  });
}
