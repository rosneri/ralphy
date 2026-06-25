import { cpus, totalmem, freemem, platform } from "node:os";
import type { SystemMetrics } from "@ralphy/events";

/**
 * Host resource sampling for the agent's per-tick CPU/memory snapshot.
 *
 * CPU utilization is a delta measurement: it needs two `cpus()` readings taken
 * some wall-clock apart, so the sampler is stateful — create one per loop and
 * call `sample()` once per poll tick. Memory and swap come from
 * `/proc/meminfo` on Linux (the only place the kernel exposes MemAvailable, the
 * figure the OOM-killer actually acts on) and fall back to `node:os` elsewhere.
 *
 * `node:os` is used deliberately: Bun exposes no native CPU/loadavg API, so it
 * is the idiomatic source for per-core times. The meminfo read is Bun-native.
 */

interface CpuAggregate {
  idle: number;
  total: number;
}

interface MemorySnapshot {
  memTotalBytes: number;
  memAvailableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

function readCpuAggregate(): CpuAggregate {
  let idle = 0;
  let total = 0;
  for (const core of cpus()) {
    const times = core.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/**
 * Host CPU utilization (0–100) between two aggregate readings. Returns 0 when
 * no wall-clock has elapsed between samples (the first tick, or a zero delta).
 */
export function cpuPercentBetween(previous: CpuAggregate, next: CpuAggregate): number {
  const totalDelta = next.total - previous.total;
  const idleDelta = next.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  const busyFraction = 1 - idleDelta / totalDelta;
  const clamped = Math.min(1, Math.max(0, busyFraction));
  return Math.round(clamped * 100);
}

/**
 * Parse the relevant rows of `/proc/meminfo`. Values are reported in kB and
 * converted to bytes. MemAvailable falls back to MemFree on kernels too old to
 * report it (pre-3.14); swap fields default to 0 when absent.
 */
export function parseMeminfo(text: string): MemorySnapshot {
  const valuesByKey = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line);
    if (match) {
      const key = match[1];
      const kilobytes = match[2];
      if (key !== undefined && kilobytes !== undefined) {
        valuesByKey.set(key, Number(kilobytes) * 1024);
      }
    }
  }
  const memTotalBytes = valuesByKey.get("MemTotal") ?? 0;
  const memAvailableBytes = valuesByKey.get("MemAvailable") ?? valuesByKey.get("MemFree") ?? 0;
  return {
    memTotalBytes,
    memAvailableBytes,
    swapTotalBytes: valuesByKey.get("SwapTotal") ?? 0,
    swapFreeBytes: valuesByKey.get("SwapFree") ?? 0,
  };
}

async function readMemory(): Promise<Omit<SystemMetrics, "cpuPercent">> {
  if (platform() === "linux") {
    try {
      const snapshot = parseMeminfo(await Bun.file("/proc/meminfo").text());
      return {
        memTotalBytes: snapshot.memTotalBytes,
        memAvailableBytes: snapshot.memAvailableBytes,
        memUsedBytes: Math.max(0, snapshot.memTotalBytes - snapshot.memAvailableBytes),
        swapTotalBytes: snapshot.swapTotalBytes,
        swapUsedBytes: Math.max(0, snapshot.swapTotalBytes - snapshot.swapFreeBytes),
      };
    } catch {
      // Fall through to the cross-platform os.* read below.
    }
  }
  const memTotalBytes = totalmem();
  const memAvailableBytes = freemem();
  return {
    memTotalBytes,
    memAvailableBytes,
    memUsedBytes: Math.max(0, memTotalBytes - memAvailableBytes),
    swapTotalBytes: 0,
    swapUsedBytes: 0,
  };
}

export interface SystemMetricsSampler {
  sample(): Promise<SystemMetrics>;
}

/**
 * Create a stateful sampler. The first `sample()` reports `cpuPercent: 0`
 * (no prior reading to diff against); every subsequent call reports
 * utilization over the interval since the previous call.
 */
export function createSystemMetricsSampler(): SystemMetricsSampler {
  let previousCpu = readCpuAggregate();
  return {
    async sample(): Promise<SystemMetrics> {
      const nextCpu = readCpuAggregate();
      const cpuPercent = cpuPercentBetween(previousCpu, nextCpu);
      previousCpu = nextCpu;
      const memory = await readMemory();
      return { cpuPercent, ...memory };
    },
  };
}

/** Compact `1.2G` / `18G` rendering of a byte count for one-line displays. */
export function formatBytesGigabytes(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 10 ? `${Math.round(gigabytes)}G` : `${gigabytes.toFixed(1)}G`;
}

/** One-line text-log rendering, e.g. `sys: cpu 42% │ mem 3.1G/30G avail 18G │ swap 0.9G/8G`. */
export function formatSystemMetricsLine(metrics: SystemMetrics): string {
  const swap =
    metrics.swapTotalBytes > 0
      ? ` │ swap ${formatBytesGigabytes(metrics.swapUsedBytes)}/${formatBytesGigabytes(metrics.swapTotalBytes)}`
      : "";
  return (
    `  sys: cpu ${metrics.cpuPercent}% │ ` +
    `mem ${formatBytesGigabytes(metrics.memUsedBytes)}/${formatBytesGigabytes(metrics.memTotalBytes)} ` +
    `avail ${formatBytesGigabytes(metrics.memAvailableBytes)}${swap}`
  );
}
