import { useRef, useState } from "react";
import type { SystemMetrics } from "@ralphy/events";
import { logCoord } from "@ralphy/log";
import {
  createSystemMetricsSampler,
  formatSystemMetricsLine,
  type SystemMetricsSampler,
} from "../shared/system-metrics";

/**
 * Owns the per-tick host CPU/memory sampler for the TUI. `sampleNow()` takes a
 * reading, pushes it into header state, writes the one-line snapshot to
 * `agent-mode.log`, and returns the sample so the caller can attach it to the
 * `poll_done` JSONL event. Call it once per poll cycle.
 */
export function useSystemMetrics(): {
  sysMetrics: SystemMetrics | null;
  sampleNow: () => Promise<SystemMetrics>;
} {
  const [sysMetrics, setSysMetrics] = useState<SystemMetrics | null>(null);
  const samplerRef = useRef<SystemMetricsSampler | null>(null);
  if (samplerRef.current === null) {
    samplerRef.current = createSystemMetricsSampler();
  }
  const sampler = samplerRef.current;

  const sampleNow = async (): Promise<SystemMetrics> => {
    const sys = await sampler.sample();
    setSysMetrics(sys);
    logCoord(formatSystemMetricsLine(sys));
    return sys;
  };

  return { sysMetrics, sampleNow };
}
