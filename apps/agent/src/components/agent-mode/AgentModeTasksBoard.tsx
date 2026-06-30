import { Box, Text } from "ink";
import type { ActiveWorker } from "../../agent/coordinator";
import {
  pipelineStages,
  statusLabel,
  type BoardTreeRow,
  type TicketRow,
} from "../task-pipeline";
import { fmtElapsed, trunc } from "../agent-mode-format";
import {
  ADVANCING_STATES,
  WORKER_WAIT_STATES,
  prLabel,
} from "./agent-mode-helpers";
import type { WorkerMeta } from "./agent-mode-coordinator";
import { LabeledBox } from "./LabeledBox";
import { Link } from "./Link";
import { PipelineCells } from "./PipelineCells";

/** TASKS board — one lifecycle row per live ticket, with dependency nesting,
 *  windowing, an overflow identifier strip, and a stall indicator. */
export function AgentModeTasksBoard({
  termWidth,
  tasksLiveness,
  board,
  tree,
  visibleTree,
  hiddenIdentifiers,
  winStart,
  focusedRow,
  activeCount,
  now,
  activeWorkers,
  workerMetaRef,
}: {
  termWidth: number;
  tasksLiveness: string;
  board: TicketRow[];
  tree: BoardTreeRow[];
  visibleTree: BoardTreeRow[];
  hiddenIdentifiers: string[];
  winStart: number;
  focusedRow: TicketRow | undefined;
  activeCount: number;
  now: number;
  activeWorkers: readonly ActiveWorker[];
  workerMetaRef: React.MutableRefObject<Map<string, WorkerMeta>>;
}) {
  const tasksInnerWidth = Math.max(0, termWidth - 2);
  const lead = "─ ";
  const hint = " ↑↓·0-9·^F·^W ";
  const live = ` ${tasksLiveness} `;
  const trail = "─";
  // Fill the header border between the left label and the right liveness
  // so the node spans exactly the inner width (labelVisualWidth = inner
  // width ⇒ LabeledBox adds no outer dashes).
  const fixed = lead.length + "TASKS".length + hint.length + live.length + trail.length;
  const fill = Math.max(1, tasksInnerWidth - fixed);
  return (
    <LabeledBox
      labelVisualWidth={tasksInnerWidth}
      labelNode={
        <Box flexDirection="row">
          <Text color="gray">{lead}</Text>
          <Text bold>TASKS</Text>
          <Text dimColor>{hint}</Text>
          <Text color="gray">{"─".repeat(fill)}</Text>
          <Text dimColor>{live}</Text>
          <Text color="gray">{trail}</Text>
        </Box>
      }
      borderColor="gray"
      width={termWidth}
      paddingX={1}
      flexDirection="column"
    >
      {board.length === 0 ? (
        <Text dimColor>no active tickets</Text>
      ) : (
        (() => {
          // The identifier column holds the dependency indent too, so a
          // nested row's `└ ` prefix (depth*2 cols) never pushes the
          // pipeline glyphs out of alignment.
          const idColWidth = Math.max(
            8,
            ...tree.map((t) => t.depth * 2 + t.row.identifier.length),
          );
          const idxWidth = String(tree.length).length + 3;
          const prefixWidth = 2 + idxWidth + idColWidth + 1;
          // Stall detection: tickets exist but none can advance — no live
          // worker, no automated step, and every remaining row is blocked,
          // awaiting confirmation, or bailed. Surface why, so an idle board
          // doesn't read as "done".
          const advancing =
            activeCount > 0 || tree.some((t) => ADVANCING_STATES.has(t.row.state));
          const hasStartableTodo = tree.some(
            (t) => t.row.state === "todo" && !(t.row.blockedByIds?.length ?? 0),
          );
          const stalled = !advancing && !hasStartableTodo;
          const blockedCount = tree.filter(
            (t) => t.row.state === "todo" && (t.row.blockedByIds?.length ?? 0) > 0,
          ).length;
          const awaitingCount = tree.filter((t) => t.row.state === "awaiting").length;
          const quarantinedCount = tree.filter(
            (t) => t.row.state === "quarantined",
          ).length;
          const stallParts = [
            blockedCount > 0 ? `${blockedCount} blocked` : null,
            awaitingCount > 0 ? `${awaitingCount} awaiting confirmation` : null,
            quarantinedCount > 0 ? `${quarantinedCount} quarantined` : null,
          ].filter((p): p is string => p !== null);
          return (
            <>
              {/* Node labels, aligned over the row glyphs via a fixed prefix */}
              <Box>
                <Text>{" ".repeat(prefixWidth)}</Text>
                <PipelineCells glyphs={null} />
              </Box>
              {visibleTree.map(({ row, depth }, i) => {
                const isFocused = row.id === focusedRow?.id;
                // `└ ` connector at depth>0, two spaces per level above.
                const indent = depth > 0 ? "  ".repeat(depth - 1) + "└ " : "";
                // Open blockers, named — includes blockers not on the
                // board (which the indent can't express).
                const blockers = row.blockedByIdentifiers ?? [];
                const activeW = activeWorkers.find((w) => w.issueId === row.id);
                const meta = activeW
                  ? workerMetaRef.current.get(activeW.changeName)
                  : undefined;
                // A work-state row with no live worker is waiting for a
                // worker slot — show a "waiting for worker" mark instead
                // of a timer that is not yet counting anything.
                const waitingForWorker = !activeW && WORKER_WAIT_STATES.has(row.state);
                // AGE: live worker uptime when active; else time since the
                // first recovery failure; else unknown.
                let age = "–";
                if (meta?.startedAt) {
                  age = fmtElapsed(now - meta.startedAt);
                } else if (!waitingForWorker && row.recovery?.firstFailedAt) {
                  const failedAt = Date.parse(row.recovery.firstFailedAt);
                  if (!Number.isNaN(failedAt)) age = fmtElapsed(now - failedAt);
                }
                const prUrl = meta?.prUrl ?? row.prUrl ?? null;
                return (
                  <Box key={row.id}>
                    <Box width={2}>
                      <Text color="white" bold>
                        {isFocused ? "▶" : " "}
                      </Text>
                    </Box>
                    <Box width={idxWidth}>
                      <Text dimColor={!isFocused}>[{winStart + i}]</Text>
                    </Box>
                    <Box width={idColWidth + 1}>
                      {indent && <Text dimColor>{indent}</Text>}
                      <Link
                        url={row.url}
                        label={row.identifier}
                        color={isFocused ? "cyan" : "gray"}
                      />
                    </Box>
                    <PipelineCells glyphs={pipelineStages(row).map((s) => s.status)} />
                    <Text color={isFocused ? "white" : "gray"} dimColor={!isFocused}>
                      {"  "}
                      {statusLabel(row)}
                    </Text>
                    {blockers.length > 0 && (
                      <Text color="yellow" dimColor={!isFocused}>
                        {"  ⛓ "}
                        {trunc(blockers.join(", "), 28)}
                      </Text>
                    )}
                    {waitingForWorker ? (
                      <Text color="yellow">{"  waiting for worker"}</Text>
                    ) : (
                      <Text dimColor>
                        {"  "}
                        {age}
                      </Text>
                    )}
                    {prUrl && (
                      <>
                        <Text dimColor>{"  ↗"}</Text>
                        <Link url={prUrl} label={prLabel(prUrl)} color="green" />
                      </>
                    )}
                  </Box>
                );
              })}
              {hiddenIdentifiers.length > 0 && (
                <Box>
                  <Text>{" ".repeat(2)}</Text>
                  <Text dimColor>{`+${hiddenIdentifiers.length} more  `}</Text>
                  <Text dimColor>{hiddenIdentifiers.join(" · ")}</Text>
                </Box>
              )}
              {stalled && (
                <Box marginTop={1}>
                  <Text color="yellow" bold>
                    {"⏸ nothing can start"}
                  </Text>
                  {stallParts.length > 0 && (
                    <Text color="yellow">{`  —  ${stallParts.join("  ·  ")}`}</Text>
                  )}
                </Box>
              )}
            </>
          );
        })()
      )}
    </LabeledBox>
  );
}
