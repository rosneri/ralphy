import { join } from "node:path";
import { Box, Text } from "ink";
import {
  phasePipeline,
  shouldShowPhasePipeline,
  shouldShowProgressBar,
  shouldShowSubtasksPanel,
  type OpenSpecPhase,
} from "@ralphy/core/openspec-phase";
import type { ActiveWorker } from "../../agent/coordinator";
import { fmtElapsed, trunc } from "../agent-mode-format";
import { SteeringField } from "../SteeringField";
import {
  MAX_PENDING_DISPLAY,
  calcProgressBar,
  fmtCmd,
  modeBadge,
  openspecPhaseColor,
  orderSubtasksForCappedDisplay,
  phaseColor,
  prLabel,
  workerBorderColor,
} from "./agent-mode-helpers";
import type { AgentModeCoordinator, WorkerMeta } from "./agent-mode-coordinator";
import { LabeledBox } from "./LabeledBox";
import { Link } from "./Link";

/** Full active-worker card: header, current task, live command, OUTPUT tail,
 *  phase pipeline, subtasks panel, steering input, and progress bar. */
export function AgentModeWorkerCard({
  worker,
  workerMetaRef,
  coordRef,
  now,
  termWidth,
  spinnerFrame,
  focusedTailLines,
  showPendingTasks,
  showAllSubtasks,
  steeringActive,
  steeringFocusedRef,
  steeringFocusedInitRef,
  steeringBufferRef,
  steeringCursorRef,
  tasksDir,
  appendSteering,
  fileEmit,
  appendLog,
}: {
  worker: ActiveWorker;
  workerMetaRef: React.MutableRefObject<Map<string, WorkerMeta>>;
  coordRef: React.RefObject<AgentModeCoordinator | null>;
  now: number;
  termWidth: number;
  spinnerFrame: string;
  focusedTailLines: number;
  showPendingTasks: boolean;
  showAllSubtasks: boolean;
  steeringActive: boolean;
  steeringFocusedRef: React.MutableRefObject<boolean>;
  steeringFocusedInitRef: React.MutableRefObject<boolean>;
  steeringBufferRef: React.MutableRefObject<string>;
  steeringCursorRef: React.MutableRefObject<number>;
  tasksDir: string;
  appendSteering: (changeDir: string, message: string) => Promise<void>;
  fileEmit: (event: Record<string, unknown>) => void;
  appendLog: (text: string, color?: string, workerLogFile?: string) => void;
}) {
  const w = worker;
  const meta = workerMetaRef.current.get(w.changeName);
  const elapsed = meta ? fmtElapsed(now - meta.startedAt) : "–";
  const iter = meta?.iter ?? 0;
  const phase = meta?.phase ?? "working";
  const phaseDetail = meta?.phaseDetail ?? "";
  const cmd = meta?.currentCmd;
  const cmdElapsed = cmd ? fmtElapsed(now - cmd.startedAt) : null;
  const tail = meta?.tail ?? [];
  const prUrl = meta?.prUrl ?? null;
  const currentTask = meta?.currentTask ?? null;
  const taskProgress = meta?.taskProgress ?? null;
  const openspecPhase = meta?.openspecPhase ?? null;
  const subtasks = meta?.subtasks ?? [];

  const mBadge = modeBadge(w.trigger);
  const pColor = phaseColor(phase);
  const bColor = workerBorderColor(phase);
  const visibleTailLines = focusedTailLines;

  /* Full card for the focused worker */
  const cardLabelWidth =
    (prUrl ? prLabel(prUrl).length + 3 : 0) + w.issueIdentifier.length + 2;
  const cardLabelNode = (
    <>
      <Text color={bColor}> </Text>
      {prUrl && <Link url={prUrl} label={prLabel(prUrl)} color="green" />}
      {prUrl && <Text color={bColor}> · </Text>}
      <Link url={w.issue.url} label={w.issueIdentifier} color="cyan" />
      <Text color={bColor}> </Text>
    </>
  );
  return (
    <LabeledBox
      key={w.changeName}
      labelNode={cardLabelNode}
      labelVisualWidth={cardLabelWidth}
      borderColor={bColor}
      flexDirection="column"
      paddingX={1}
      width={termWidth}
    >
      {/* ── Card header ─────────────────────────────── */}
      <Box gap={2}>
        <Text>{spinnerFrame}</Text>
        <Text color="white" bold>
          {trunc(w.issue.title, Math.max(20, termWidth - 55))}
        </Text>
        <Text color={mBadge.color} bold>
          [{mBadge.text}]
        </Text>
        <Text color={pColor} bold>
          {phase}
          {phaseDetail ? ` (${phaseDetail})` : ""}
        </Text>
        <Text dimColor>│</Text>
        <Text color="white">{elapsed}</Text>
        <Text dimColor>│</Text>
        <Text dimColor>↺</Text>
        <Text color="white" bold>
          {iter}
        </Text>
      </Box>

      {/* ── Current task ────────────────────────────── */}
      {currentTask && (
        <Box gap={1} marginTop={0}>
          <Text color="yellow" bold>
            ▶ TASK
          </Text>
          {openspecPhase && (
            <Text color={openspecPhaseColor(openspecPhase)} bold>
              [phase: {openspecPhase}]
            </Text>
          )}
          <Text color="white">
            {trunc(
              currentTask,
              termWidth - 14 - (openspecPhase ? openspecPhase.length + 11 : 0),
            )}
          </Text>
        </Box>
      )}

      {/* ── Command (when active) ────────────────────── */}
      {cmd && (
        <Box gap={1} marginTop={0}>
          <Text color="yellow">⏵ CMD</Text>
          <Text color="yellow">{fmtCmd(cmd.argv)}</Text>
          <Text dimColor>{cmdElapsed}</Text>
        </Box>
      )}

      {/* ── Output tail ─────────────────────────────── */}
      {tail.length > 0 && !(showPendingTasks && showAllSubtasks) && (
        <Box flexDirection="column" marginTop={0}>
          <Text dimColor>
            {"─ OUTPUT "}
            {"─".repeat(Math.max(4, termWidth - 14))}
          </Text>
          {tail.slice(-visibleTailLines).map((line, i) => (
            <Text key={`${w.changeName}-tail-${i}`} dimColor>
              {"│ "}
              {trunc(line, termWidth - 6)}
            </Text>
          ))}
        </Box>
      )}

      {/* ── Phase pipeline (pre-implement phases) ───── */}
      {shouldShowPhasePipeline(openspecPhase) && (
        <Box marginTop={0}>
          {phasePipeline(openspecPhase as OpenSpecPhase).map((seg, i, arr) => {
            const glyph =
              seg.status === "done" ? "✓" : seg.status === "current" ? "●" : "○";
            const node =
              seg.status === "done" ? (
                <Text color="green">
                  {glyph} {seg.label}
                </Text>
              ) : seg.status === "current" ? (
                <Text color={openspecPhaseColor(seg.phase)} bold>
                  {glyph} {seg.label}
                </Text>
              ) : (
                <Text dimColor>
                  {glyph} {seg.label}
                </Text>
              );
            return (
              <Box key={seg.phase}>
                {node}
                {i < arr.length - 1 && <Text dimColor> ─ </Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── Subtasks panel (Ctrl+T) ─────────────────── */}
      {shouldShowSubtasksPanel(openspecPhase, showPendingTasks, subtasks.length > 0) && (
        <Box flexDirection="column" marginTop={0}>
          {(() => {
            const header = `─ SUBTASKS (${subtasks.length}) CTRL+T to close `;
            const pad = "─".repeat(Math.max(4, termWidth - header.length - 4));
            return <Text dimColor>{`${header}${pad}`}</Text>;
          })()}
          {(showAllSubtasks
            ? subtasks
            : orderSubtasksForCappedDisplay(subtasks).slice(0, MAX_PENDING_DISPLAY)
          ).map((s, i, arr) => {
            const ord = `${i + 1}.`.padStart(`${arr.length}.`.length, " ");
            const reserved = ord.length + 5; // "ord [x] "
            return (
              <Text key={`${w.changeName}-subtask-${i}`}>
                {s.done ? (
                  <Text dimColor>{`${ord} [x] `}</Text>
                ) : (
                  <Text>{`${ord} [ ] `}</Text>
                )}
                {s.done ? (
                  <Text dimColor>{trunc(s.text, termWidth - reserved)}</Text>
                ) : (
                  <Text>{trunc(s.text, termWidth - reserved)}</Text>
                )}
              </Text>
            );
          })}
          {!showAllSubtasks && subtasks.length > MAX_PENDING_DISPLAY && (
            <Text dimColor>
              {`    … +${subtasks.length - MAX_PENDING_DISPLAY} more (CTRL+L to expand)`}
            </Text>
          )}
        </Box>
      )}

      {/* ── Steering input (Ctrl+S) ─────────────────── */}
      {steeringActive && (
        <Box marginTop={0}>
          <SteeringField
            active={steeringActive}
            width={termWidth - 2}
            initialBuffer={steeringBufferRef.current}
            initialCursor={steeringCursorRef.current}
            initialFocused={steeringFocusedInitRef.current}
            onFocusChange={(f) => {
              steeringFocusedRef.current = f;
              steeringFocusedInitRef.current = f;
            }}
            onStateChange={(s) => {
              steeringBufferRef.current = s.buffer;
              steeringCursorRef.current = s.cursor;
            }}
            onSubmit={async (message) => {
              try {
                await appendSteering(join(tasksDir, w.changeName), message);
                fileEmit({
                  type: "steering_submitted",
                  changeName: w.changeName,
                  message,
                });
              } catch (err) {
                const text = (err as Error).message;
                fileEmit({
                  type: "error",
                  code: "steering_failure",
                  changeName: w.changeName,
                  text,
                });
                appendLog(`! steering append failed for ${w.changeName}: ${text}`, "red");
                throw err;
              }
              // Fire the comment-sync hook (best-effort) before the
              // worker restart so the steering comment lands on
              // Linear even if the new iteration hasn't synced yet.
              try {
                await coordRef.current?.notifySteeringAppended?.(w.changeName, message);
              } catch {
                /* hook errors are already logged inside the coordinator */
              }
              const restarted = await coordRef.current?.restartWorker(w.changeName);
              fileEmit({
                type: "worker_restart",
                changeName: w.changeName,
                restarted: !!restarted,
              });
              if (restarted) {
                appendLog(
                  `  ${w.changeName}: steering applied, restarting worker`,
                  "cyan",
                );
              } else {
                appendLog(
                  `  ${w.changeName}: steering queued — will apply on next iteration`,
                  "gray",
                );
              }
            }}
          />
        </Box>
      )}

      {/* ── Task progress bar (when panel collapsed) ── */}
      {shouldShowProgressBar(openspecPhase, showPendingTasks, taskProgress !== null) &&
        taskProgress &&
        (() => {
          const hint = " CTRL+T to open";
          const bar = calcProgressBar(
            taskProgress.checked,
            taskProgress.total,
            termWidth - 4 - hint.length,
          );
          if (!bar) return null;
          const { countStr, filledLeft, leftSlot, filledRight, rightSlot } = bar;
          return (
            <Box marginTop={0}>
              <Text dimColor>[</Text>
              <Text color="green">{"█".repeat(filledLeft)}</Text>
              <Text dimColor>{"░".repeat(leftSlot - filledLeft)}</Text>
              <Text color="white" bold>
                {countStr}
              </Text>
              <Text color="green">{"█".repeat(filledRight)}</Text>
              <Text dimColor>{"░".repeat(rightSlot - filledRight)}</Text>
              <Text dimColor>]</Text>
              <Text dimColor>{hint}</Text>
            </Box>
          );
        })()}
    </LabeledBox>
  );
}
