export type { RalphEvent, RalphEventType, EmitInput, PollBuckets, PrStatusCounts } from "./types";
export type { SystemMetrics } from "./system-metrics";
export { createBus, createNoopBus, type Bus, type Listener } from "./bus";
export { createRing, type Ring } from "./ring";
export { subscribeFileLogger, type FileLoggerOptions } from "./consumers/file-logger";
export { POSTHOG_EVENT_ALLOWLIST, subscribePostHog, type CaptureFn } from "./consumers/posthog";
export { subscribeTuiStream, BufferSink, type TuiSink } from "./consumers/tui-stream";
export { subscribeJsonOutput, JsonBufferSink, type JsonSink } from "./consumers/json-output";
export { subscribeAgentDiag } from "./consumers/agent-diag";

import type { Bus } from "./bus";
import { subscribeFileLogger } from "./consumers/file-logger";
import { subscribePostHog } from "./consumers/posthog";
import { capture as telemetryCapture } from "@ralphy/telemetry";

export interface AttachDefaultsOptions {
  bus: Bus;
  fileLoggerRoot?: string;
}

let processBus: Bus | null = null;

/** Set the per-process bus. Called by the shell entry once. */
export function setProcessBus(bus: Bus | null): void {
  processBus = bus;
}

/** Get the per-process bus, falling back to a fresh no-op bus when no
 *  entry point has wired one. Lets module-level call sites (React
 *  hooks, json-runner) emit without taking a bus parameter. */
export function getProcessBus(): Bus {
  return processBus ?? noopFallback;
}

import { createNoopBus as _createNoopBus } from "./bus";
const noopFallback: Bus = _createNoopBus();

/**
 * Installs the default consumers (file logger + PostHog) on the given
 * bus. Returns an unsubscribe that detaches both.
 */
export function attachDefaults(opts: AttachDefaultsOptions): () => void {
  const { bus, fileLoggerRoot } = opts;
  const offFile = subscribeFileLogger(
    bus,
    fileLoggerRoot !== undefined ? { rootDir: fileLoggerRoot } : {},
  );
  const offPosthog = subscribePostHog(bus, telemetryCapture);
  return () => {
    offFile();
    offPosthog();
  };
}
