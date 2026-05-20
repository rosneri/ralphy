/**
 * Discriminated union of every event flowing through the @ralphy/events bus.
 *
 * The union covers two source flows (audited via grep over the repo):
 *  - Every `capture(...)` event name (telemetry / PostHog).
 *  - Every `type:` literal that `runAgentJson` emits on its JSON stream.
 *
 * Plus the internal `__bus_error__` variant the bus uses to surface
 * subscriber failures without losing them.
 */

export interface PollBuckets {
  todo: number;
  inProgress: number;
  conflicted: number;
  review: number;
  mentions: number;
  awaiting: number;
}

export interface PrStatusCounts {
  mergeable: number;
  conflicted: number;
  ciFailed: number;
}

export type RalphEvent =
  // --- shell / lifecycle (capture) ---
  | { type: "command_run"; ts: number; subcommand: string }
  | { type: "command_exit"; ts: number; subcommand: string; exit_code: number }
  | {
      type: "command_error";
      ts: number;
      subcommand: string;
      error_message: string;
      error_name?: string;
      error_stack?: string;
    }
  // --- loop (capture) ---
  | {
      type: "task_started";
      ts: number;
      task_name?: string;
      engine?: string;
      [k: string]: unknown;
    }
  | {
      type: "task_stopped";
      ts: number;
      [k: string]: unknown;
    }
  | {
      type: "iteration_failed";
      ts: number;
      iteration?: number;
      [k: string]: unknown;
    }
  | {
      type: "engine_rate_limited";
      ts: number;
      exit_code?: number;
      iteration?: number;
    }
  | {
      type: "engine_error";
      ts: number;
      iteration?: number;
      error?: string;
    }
  // --- agent coordinator (capture) ---
  | {
      type: "agent_linear_poll_failed";
      ts: number;
      error?: string;
    }
  | {
      type: "agent_indicator_failed";
      ts: number;
      [k: string]: unknown;
    }
  | {
      type: "agent_conflict_promoted";
      ts: number;
      [k: string]: unknown;
    }
  | {
      type: "agent_conflict_detected";
      ts: number;
      issue_identifier: string;
    }
  | {
      type: "agent_prepare_failed";
      ts: number;
      [k: string]: unknown;
    }
  | {
      type: "agent_worker_spawned";
      ts: number;
      spawn_mode?: string;
      issue_identifier?: string;
      change_name?: string;
      pid?: number;
      [k: string]: unknown;
    }
  | {
      type: "agent_worker_exited";
      ts: number;
      spawn_mode?: string;
      issue_identifier?: string;
      exit_code?: number;
      ok?: boolean;
      [k: string]: unknown;
    }
  | {
      type: "agent_worker_restarted";
      ts: number;
      [k: string]: unknown;
    }
  | {
      type: "agent_worker_reaped_for_awaiting";
      ts: number;
      change_name: string;
    }
  // --- runAgentJson stream ---
  | {
      type: "started";
      ts: number;
      version?: string;
      filterDesc?: string;
      concurrency?: number;
      pollInterval?: number;
      configPath?: string;
      [k: string]: unknown;
    }
  | { type: "log"; ts: number; text: string; color?: string }
  | { type: "poll_start"; ts: number }
  | {
      type: "poll_done";
      ts: number;
      found: number;
      added: number;
      buckets: PollBuckets;
      prStatus: PrStatusCounts;
    }
  | {
      type: "worker_started";
      ts: number;
      changeName: string;
      statesDir?: string;
      logFile?: string;
      changeDir?: string;
      [k: string]: unknown;
    }
  | {
      type: "worker_exited";
      ts: number;
      changeName: string;
      [k: string]: unknown;
    }
  | {
      type: "worker_phase";
      ts: number;
      changeName: string;
      phase: string;
    }
  | {
      type: "worker_output";
      ts: number;
      changeName: string;
      text: string;
      [k: string]: unknown;
    }
  | {
      type: "worker_cmd_start";
      ts: number;
      changeName: string;
      [k: string]: unknown;
    }
  | {
      type: "worker_cmd_end";
      ts: number;
      changeName: string;
      durationMs?: number;
      ok?: boolean;
      [k: string]: unknown;
    }
  | {
      type: "worker_pr";
      ts: number;
      changeName: string;
      url?: string;
      [k: string]: unknown;
    }
  | {
      type: "awaiting_confirmation";
      ts: number;
      [k: string]: unknown;
    }
  | { type: "stopped"; ts: number; [k: string]: unknown }
  // --- internal ---
  | {
      type: "__bus_error__";
      ts: number;
      consumer: string;
      error_message: string;
      error_stack?: string;
    };

export type RalphEventType = RalphEvent["type"];

export type EmitInput<E extends RalphEvent = RalphEvent> = E extends RalphEvent
  ? Omit<E, "ts"> & { ts?: number }
  : never;
