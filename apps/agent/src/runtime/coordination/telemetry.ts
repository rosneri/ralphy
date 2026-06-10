import { capture as telemetryCapture } from "@ralphy/telemetry";
import type { Bus, EmitInput, RalphEvent } from "@ralphy/events";

/**
 * Stage 1: Emits to PostHog AND to the event bus side-by-side. The legacy
 * `capture(event, props)` call sites switch to `capture.call(this, ...)`
 * via a small helper so neither sink is missed.
 */
export function emitCapture<T extends RalphEvent["type"]>(
  bus: Bus,
  event: T,
  properties?: Record<string, unknown>,
): void {
  telemetryCapture(event, properties);
  bus.emit({ type: event, ...properties } as Extract<EmitInput, { type: T }>);
}
