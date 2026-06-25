/**
 * Host-wide resource snapshot sampled once per poll tick. Captured so an
 * overnight memory storm (the kind that triggers the OOM-killer) is visible
 * after the fact in the JSONL stream and the text log, not just inferred from
 * the loop going silent.
 */
export interface SystemMetrics {
  /** Host CPU utilization (0–100) averaged over the interval since the previous sample. */
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  /** Kernel MemAvailable — memory allocatable without swapping; the figure the OOM-killer acts on. */
  memAvailableBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
}
