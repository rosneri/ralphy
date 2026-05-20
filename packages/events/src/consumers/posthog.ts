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
  "agent_prepare_failed",
  "agent_worker_spawned",
  "agent_worker_exited",
  "agent_worker_restarted",
  "agent_worker_reaped_for_awaiting",
]);

export type CaptureFn = (event: string, properties?: Record<string, unknown>) => void;

export function subscribePostHog(bus: Bus, capture: CaptureFn): () => void {
  return bus.on("*", (event: RalphEvent) => {
    if (!POSTHOG_EVENT_ALLOWLIST.has(event.type)) return;
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
    capture(event.type, props);
  });
}
