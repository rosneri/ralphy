import type { Bus } from "../bus";
import type { RalphEvent, RalphEventType } from "../types";

/** Event names that should be forwarded to PostHog. */
export const POSTHOG_EVENT_ALLOWLIST: ReadonlySet<RalphEventType> = new Set<RalphEventType>([
  "command_run",
  "command_exit",
  "command_error",
  "task_started",
  "task_stopped",
  "iteration_failed",
  "engine_rate_limited",
  "engine_error",
  "agent_linear_poll_failed",
  "agent_indicator_failed",
  "agent_conflict_promoted",
  "agent_conflict_detected",
  "agent_ci_failed_detected",
  "agent_prepare_failed",
  "agent_worker_spawned",
  "agent_worker_exited",
  "agent_worker_restarted",
  "agent_worker_reaped_for_awaiting",
]);

/** Bus-native loop events forwarded to PostHog under their prior (unprefixed) names
 *  to preserve telemetry parity. */
export const LOOP_EVENT_ALIAS: Readonly<Record<string, string>> = Object.freeze({
  "loop.task_started": "task_started",
  "loop.task_stopped": "task_stopped",
  "loop.iteration_failed": "iteration_failed",
  "loop.engine_rate_limited": "engine_rate_limited",
  "loop.engine_error": "engine_error",
});

export type CaptureFn = (event: string, properties?: Record<string, unknown>) => void;

export function subscribePostHog(bus: Bus, capture: CaptureFn): () => void {
  return bus.on("*", (event: RalphEvent) => {
    const aliased = LOOP_EVENT_ALIAS[event.type];
    const forwardName = aliased ?? (POSTHOG_EVENT_ALLOWLIST.has(event.type) ? event.type : null);
    if (forwardName === null) return;
    const {
      type: _type,
      ts: _ts,
      ...props
    } = event as Record<string, unknown> & {
      type: string;
      ts: number;
    };
    void _type;
    void _ts;
    capture(forwardName, props);
  });
}
