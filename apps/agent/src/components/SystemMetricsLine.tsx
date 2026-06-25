import { Text } from "ink";
import type { SystemMetrics } from "@ralphy/events";
import { formatBytesGigabytes } from "../shared/system-metrics";

/**
 * Header line showing host CPU/memory/swap, sampled each poll. Colors shift
 * toward red as available memory drops or swap fills, so a memory storm is
 * visible at a glance before the OOM-killer intervenes.
 */
export function SystemMetricsLine({ metrics }: { metrics: SystemMetrics }): React.ReactElement {
  const availableFraction =
    metrics.memTotalBytes > 0 ? metrics.memAvailableBytes / metrics.memTotalBytes : 1;
  const swapFraction =
    metrics.swapTotalBytes > 0 ? metrics.swapUsedBytes / metrics.swapTotalBytes : 0;

  const cpuColor = metrics.cpuPercent >= 90 ? "red" : metrics.cpuPercent >= 70 ? "yellow" : "green";
  const memColor = availableFraction < 0.1 ? "red" : availableFraction < 0.2 ? "yellow" : "green";
  const swapColor = swapFraction > 0.5 ? "red" : swapFraction > 0.1 ? "yellow" : "green";

  return (
    <Text>
      <Text dimColor>sys </Text>
      <Text color={cpuColor}>cpu {metrics.cpuPercent}%</Text>
      <Text dimColor> · </Text>
      <Text color={memColor}>
        mem {formatBytesGigabytes(metrics.memUsedBytes)}/
        {formatBytesGigabytes(metrics.memTotalBytes)} (avail{" "}
        {formatBytesGigabytes(metrics.memAvailableBytes)})
      </Text>
      {metrics.swapTotalBytes > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color={swapColor}>
            swap {formatBytesGigabytes(metrics.swapUsedBytes)}/
            {formatBytesGigabytes(metrics.swapTotalBytes)}
          </Text>
        </>
      )}
    </Text>
  );
}
