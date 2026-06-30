import { Text } from "ink";
import type { SystemMetrics } from "@ralphy/events";
import type { RalphyConfig } from "../../agent/config";
import { SystemMetricsLine } from "../SystemMetricsLine";
import { LabeledBox } from "./LabeledBox";

/** Two-line settings header: key config, host metrics, Linear filter, authed user. */
export function AgentModeSettingsHeader({
  version,
  cfg,
  effective,
  maxTickets,
  sysMetrics,
  filterDesc,
  authedUser,
  termWidth,
}: {
  version: string;
  cfg: RalphyConfig | null;
  effective: { concurrency: number; pollInterval: number } | null;
  maxTickets: number;
  sysMetrics: SystemMetrics | null;
  filterDesc: string;
  authedUser: { name: string; email: string } | null;
  termWidth: number;
}) {
  return (
    <LabeledBox
      label="◈ RALPH AGENT"
      borderColor="blue"
      width={termWidth}
      paddingX={1}
      flexDirection="column"
    >
      {/* Line 1: key settings */}
      <Text>
        <Text dimColor>v{version}</Text>
        {cfg && (
          <Text>
            <Text dimColor> │ </Text>
            <Text color="cyan" bold>
              {cfg.engine}/{cfg.model}
            </Text>
            <Text dimColor> │ ×{effective?.concurrency ?? cfg.concurrency}</Text>
            <Text dimColor> │ poll {effective?.pollInterval ?? cfg.pollIntervalSeconds}s</Text>
            {cfg.maxIterationsPerTask > 0 && (
              <Text color="yellow"> │ iter ≤{cfg.maxIterationsPerTask}</Text>
            )}
            {cfg.maxCostUsdPerTask > 0 && (
              <Text color="yellow"> │ cost ≤${cfg.maxCostUsdPerTask}</Text>
            )}
            {maxTickets > 0 && <Text color="yellow"> │ tickets ≤{maxTickets}</Text>}
            {cfg.createPrOnSuccess && <Text color="green"> ● PR</Text>}
            {cfg.prRecovery.enabled && (
              <Text color="green"> ● recover{cfg.prRecovery.fixCi ? "+CI" : ""}</Text>
            )}
            {cfg.useWorktree && <Text color="green"> ● worktree</Text>}
          </Text>
        )}
      </Text>
      {/* Line 1b: host CPU/memory/swap, sampled each poll. */}
      {sysMetrics && <SystemMetricsLine metrics={sysMetrics} />}
      {/* Line 2+: Linear filter — wrapped across as many lines as needed */}
      {filterDesc &&
        (() => {
          const prefix = "Linear  ";
          const indent = " ".repeat(prefix.length);
          const full = filterDesc.replace(/, /g, "  ·  ");
          const lineWidth = Math.max(20, termWidth - 4);
          const lines: string[] = [];
          let remaining = full;
          while (remaining.length > 0) {
            const budget = lineWidth - (lines.length === 0 ? prefix.length : indent.length);
            lines.push(remaining.slice(0, budget));
            remaining = remaining.slice(budget);
          }
          return lines.map((segment, i) => (
            <Text key={i} dimColor>
              {i === 0 ? prefix : indent}
              {segment}
            </Text>
          ));
        })()}
      {/* Line 3: authenticated Linear user — makes a wrong/expired key
          visible instead of silently matching zero tickets. */}
      {authedUser ? (
        <Text dimColor>{`Auth    ${authedUser.name} <${authedUser.email}>`}</Text>
      ) : (
        <Text color="yellow">
          {"Auth    LINEAR_API_KEY did not resolve a user — key may be invalid or expired"}
        </Text>
      )}
    </LabeledBox>
  );
}
