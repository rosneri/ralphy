import { describe, expect, test } from "bun:test";
import {
  parseMeminfo,
  cpuPercentBetween,
  formatBytesGigabytes,
  formatSystemMetricsLine,
  createSystemMetricsSampler,
} from "../shared/system-metrics";

describe("parseMeminfo", () => {
  const sample = [
    "MemTotal:       30844320 kB",
    "MemFree:         1048576 kB",
    "MemAvailable:   18874368 kB",
    "Buffers:          512000 kB",
    "SwapTotal:       8388608 kB",
    "SwapFree:        7340032 kB",
    "",
  ].join("\n");

  test("converts kB rows to bytes", () => {
    const result = parseMeminfo(sample);
    expect(result.memTotalBytes).toBe(30844320 * 1024);
    expect(result.memAvailableBytes).toBe(18874368 * 1024);
    expect(result.swapTotalBytes).toBe(8388608 * 1024);
    expect(result.swapFreeBytes).toBe(7340032 * 1024);
  });

  test("falls back to MemFree when MemAvailable is absent (pre-3.14 kernels)", () => {
    const withoutAvailable = "MemTotal: 1024 kB\nMemFree: 256 kB\n";
    expect(parseMeminfo(withoutAvailable).memAvailableBytes).toBe(256 * 1024);
  });

  test("defaults missing swap fields to zero", () => {
    const result = parseMeminfo("MemTotal: 1024 kB\nMemAvailable: 512 kB\n");
    expect(result.swapTotalBytes).toBe(0);
    expect(result.swapFreeBytes).toBe(0);
  });

  test("ignores malformed lines without throwing", () => {
    const result = parseMeminfo("garbage\nMemTotal: 2048 kB\nHugePages_Total:   0\n");
    expect(result.memTotalBytes).toBe(2048 * 1024);
  });
});

describe("cpuPercentBetween", () => {
  test("50% busy over the interval", () => {
    const previous = { idle: 1000, total: 2000 };
    const next = { idle: 1500, total: 3000 };
    // idleDelta=500, totalDelta=1000 → busy = 1 - 0.5 = 50%
    expect(cpuPercentBetween(previous, next)).toBe(50);
  });

  test("fully idle reports 0%", () => {
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 100, total: 100 })).toBe(0);
  });

  test("fully busy reports 100%", () => {
    expect(cpuPercentBetween({ idle: 50, total: 50 }, { idle: 50, total: 150 })).toBe(100);
  });

  test("zero or negative interval reports 0% rather than dividing by zero", () => {
    expect(cpuPercentBetween({ idle: 10, total: 100 }, { idle: 10, total: 100 })).toBe(0);
  });
});

describe("formatBytesGigabytes", () => {
  test("one decimal under 10G, rounded whole at or above", () => {
    expect(formatBytesGigabytes(3.14 * 1024 ** 3)).toBe("3.1G");
    expect(formatBytesGigabytes(18 * 1024 ** 3)).toBe("18G");
    expect(formatBytesGigabytes(0)).toBe("0.0G");
  });
});

describe("formatSystemMetricsLine", () => {
  test("renders a compact one-liner with swap when present", () => {
    const line = formatSystemMetricsLine({
      cpuPercent: 42,
      memUsedBytes: 3.1 * 1024 ** 3,
      memTotalBytes: 30 * 1024 ** 3,
      memAvailableBytes: 18 * 1024 ** 3,
      swapUsedBytes: 0.9 * 1024 ** 3,
      swapTotalBytes: 8 * 1024 ** 3,
    });
    expect(line).toContain("sys: cpu 42%");
    expect(line).toContain("mem 3.1G/30G avail 18G");
    expect(line).toContain("swap 0.9G/8.0G");
  });

  test("omits swap segment when there is no swap device", () => {
    const line = formatSystemMetricsLine({
      cpuPercent: 5,
      memUsedBytes: 1 * 1024 ** 3,
      memTotalBytes: 16 * 1024 ** 3,
      memAvailableBytes: 14 * 1024 ** 3,
      swapUsedBytes: 0,
      swapTotalBytes: 0,
    });
    expect(line).not.toContain("swap");
  });
});

describe("createSystemMetricsSampler", () => {
  test("first sample reports cpuPercent 0 and live memory totals", async () => {
    const sampler = createSystemMetricsSampler();
    const first = await sampler.sample();
    expect(first.cpuPercent).toBe(0);
    expect(first.memTotalBytes).toBeGreaterThan(0);
    expect(first.memAvailableBytes).toBeGreaterThanOrEqual(0);
    expect(first.memUsedBytes).toBe(Math.max(0, first.memTotalBytes - first.memAvailableBytes));
  });

  test("subsequent samples report a bounded cpu percentage", async () => {
    const sampler = createSystemMetricsSampler();
    await sampler.sample();
    const second = await sampler.sample();
    expect(second.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(second.cpuPercent).toBeLessThanOrEqual(100);
  });
});
