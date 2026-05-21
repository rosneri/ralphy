import type { Bus } from "../bus";

/**
 * Bridges `agent.diag` bus events back to a human log sink.
 *
 * Wire.ts emits `agent.diag` events instead of calling its `onLog`
 * parameter directly. The shell entry (json-runner / Ink dashboard)
 * subscribes via this helper to forward each event to the existing
 * `onLog(text, color?)` callback so the UI output is unchanged.
 */
export function subscribeAgentDiag(
  bus: Bus,
  onLog: (text: string, color?: string) => void,
): () => void {
  return bus.on("agent.diag", (ev) => {
    if (ev.color !== undefined) onLog(ev.message, ev.color);
    else onLog(ev.message);
  });
}
