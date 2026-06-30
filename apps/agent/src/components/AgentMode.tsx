import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useInput, useStdin } from "ink";
import { VERSION, type AgentParsedArgs } from "../cli";
import {
  ensureRalphyConfig as ensureRalphyConfigImpl,
  loadEffectiveConfig as loadEffectiveConfigImpl,
} from "../agent/config";
import { buildAgentCoordinator as buildAgentCoordinatorImpl } from "../agent/wire";
import {
  runPreflight as runPreflightImpl,
  type PreflightResult,
  type PreflightOptions,
} from "@ralphy/engine/preflight";
import { useTerminalSize } from "@ralphy/ui-shared/useTerminalSize";
import { useHoldToClose } from "@ralphy/ui-shared/useHoldToClose";
import { SPINNER_FRAMES, computeBoardLayout } from "./agent-mode/agent-mode-helpers";
import {
  appendSteeringImpl,
  type AgentModeBuildCoordinator,
} from "./agent-mode/agent-mode-coordinator";
import { useAgentModeController } from "./agent-mode/useAgentModeController";
import { AgentModeSettingsHeader } from "./agent-mode/AgentModeSettingsHeader";
import { AgentModeTasksBoard } from "./agent-mode/AgentModeTasksBoard";
import { AgentModeWorkerCard } from "./agent-mode/AgentModeWorkerCard";
import { AgentModeParkedCard } from "./agent-mode/AgentModeParkedCard";

interface AgentModeProps {
  args: AgentParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  /** Test injection — defaults to the real `appendSteering` helper. */
  appendSteering?: (changeDir: string, message: string) => Promise<void>;
  /** Test injection — defaults to the real `buildAgentCoordinator`. */
  buildCoordinator?: AgentModeBuildCoordinator;
  /** Test injection — defaults to the real `ensureRalphyConfig`. */
  ensureConfig?: typeof ensureRalphyConfigImpl;
  /** Test injection — defaults to the real `loadEffectiveConfig`. */
  loadConfig?: typeof loadEffectiveConfigImpl;
  /** Test injection — defaults to the real `runPreflight`. */
  runPreflight?: (opts?: PreflightOptions) => Promise<PreflightResult>;
}

export function AgentMode({
  args,
  projectRoot,
  statesDir,
  tasksDir,
  appendSteering = appendSteeringImpl,
  buildCoordinator = buildAgentCoordinatorImpl,
  ensureConfig = ensureRalphyConfigImpl,
  loadConfig = loadEffectiveConfigImpl,
  runPreflight = runPreflightImpl,
}: AgentModeProps) {
  const { isRawModeSupported } = useStdin();
  const { columns, rows, resizeKey } = useTerminalSize();
  const {
    logs,
    logTrimGeneration,
    appendLog,
    sysMetrics,
    preflightError,
    fatalExit,
    clock,
    effective,
    pollStatus,
    authedUser,
    coordRef,
    workerMetaRef,
    nextPollAtRef,
    cfgRef,
    fileEmit,
  } = useAgentModeController({
    args,
    projectRoot,
    statesDir,
    tasksDir,
    buildCoordinator,
    ensureConfig,
    loadConfig,
    runPreflight,
  });

  // `heldRef` records whether we actually paused (interactive TTY) so we can
  // exit clean on acknowledgment and let the tmux crash fallback stay quiet,
  // versus surfacing the real code on an immediate (non-interactive) close.
  const heldRef = useRef(false);
  const { awaitingClose } = useHoldToClose({
    finished: fatalExit !== null,
    hold: true,
    onClose: () => {
      // Acknowledged in-app → exit clean so the tmux crash fallback stays quiet;
      // closed immediately (no TTY) → surface the real failure code.
      const code = heldRef.current ? 0 : (fatalExit ?? 0);
      setTimeout(() => process.exit(code), 200);
    },
  });
  useEffect(() => {
    if (awaitingClose) heldRef.current = true;
  }, [awaitingClose]);

  /** Id of the focused board ticket. Null until the first navigation; the
   *  render clamps a null/missing id to the first board row. Focus is by id,
   *  not index, so it survives rows being added/removed/reordered between
   *  polls. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** Toggled by Ctrl+T — show the focused worker's pending tasks at the bottom of its card. */
  const [showPendingTasks, setShowPendingTasks] = useState(false);
  /** Toggled by Ctrl+L — expand subtasks over the OUTPUT feed (no cap). */
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  /** Toggled by Ctrl+F — the TASKS board takes the whole screen, showing every
   *  ticket as a full row (capped at terminal height) instead of the 10-row cap. */
  const [boardFullScreen, setBoardFullScreen] = useState(false);
  /** Toggled by Ctrl+W — the active (working) ticket's card takes the whole
   *  screen: pipeline + a tall OUTPUT tail, with the board hidden. */
  const [cardFullScreen, setCardFullScreen] = useState(false);

  const steeringFocusedRef = useRef(false);
  // Resize-survival mirrors: SteeringField may be re-mounted by the
  // resizeKey-keyed Box below, so we persist its state in refs here and
  // re-seed via the initial* props on remount.
  const steeringBufferRef = useRef<string>("");
  const steeringCursorRef = useRef<number>(0);
  const steeringFocusedInitRef = useRef<boolean>(false);

  const coord = coordRef.current;
  const cfg = cfgRef.current;
  const spinnerFrame = SPINNER_FRAMES[clock % SPINNER_FRAMES.length]!;
  const now = Date.now();
  const secsToNextPoll = nextPollAtRef.current
    ? Math.max(0, Math.ceil((nextPollAtRef.current - now) / 1000))
    : null;
  // Liveness for the TASKS box header — poll state + next-poll countdown, no
  // spinner (the header is a static border line).
  const pollState =
    pollStatus.state === "polling" ? "polling…" : pollStatus.lastAt !== null ? "idle" : "starting…";
  const tasksLiveness = `${pollState}${secsToNextPoll !== null ? ` · ${secsToNextPoll}s ↻` : ""}`;
  const activeCount = coord?.activeCount ?? 0;
  const termWidth = columns - 2;
  const termHeight = rows;

  // The board (one row per live ticket) is the navigable list. Focus is by id;
  // the layout helper recomputes the index each render and clamps a null/missing
  // id to the first row, so focus survives rows being added/removed/reordered.
  const board = pollStatus.lastBoard;
  const activeWorkers = coordRef.current?.activeWorkers ?? [];
  const {
    tree,
    focusedIndex,
    focusedRow,
    focusedWorker,
    winStart,
    visibleTree,
    hiddenIdentifiers,
    steeringActive,
    focusedTailLines,
  } = computeBoardLayout({
    board,
    activeWorkers,
    focusedId,
    boardFullScreen,
    cardFullScreen,
    isRawModeSupported,
    termWidth,
    termHeight,
    activeCount,
  });

  useInput(
    (input, key) => {
      if (steeringFocusedRef.current) return;
      if (key.ctrl && (input === "l" || input === "L")) {
        if (activeCount > 0) setShowAllSubtasks((v) => !v);
        return;
      }
      if (key.ctrl && (input === "t" || input === "T")) {
        if (activeCount > 0) setShowPendingTasks((v) => !v);
        return;
      }
      if (key.ctrl && (input === "f" || input === "F")) {
        setBoardFullScreen((v) => !v);
        setCardFullScreen(false);
        return;
      }
      if (key.ctrl && (input === "w" || input === "W")) {
        // Full-screen the working ticket's card. Keep focus if it is already a
        // live worker, else jump to the first active (working) one.
        const workers = coordRef.current?.activeWorkers ?? [];
        if (workers.length === 0) return;
        if (!workers.some((wk) => wk.issueId === focusedId)) setFocusedId(workers[0]!.issueId);
        setCardFullScreen((v) => !v);
        setBoardFullScreen(false);
        return;
      }
      if (tree.length === 0) return;
      const idx = focusedIndex < 0 ? 0 : focusedIndex;
      if (key.tab || key.downArrow) {
        setFocusedId(tree[(idx + 1) % tree.length]!.row.id);
      } else if (key.upArrow) {
        setFocusedId(tree[(idx - 1 + tree.length) % tree.length]!.row.id);
      } else {
        const n = parseInt(input, 10);
        if (!isNaN(n) && n >= 0 && n <= Math.min(9, tree.length - 1)) setFocusedId(tree[n]!.row.id);
      }
    },
    { isActive: isRawModeSupported && board.length > 0 },
  );

  if (preflightError) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          ✖ Preflight failed — {preflightError.tool}
        </Text>
        <Text color="red">{preflightError.message}</Text>
        {awaitingClose && <Text color="cyan">{"\n"}Press Enter to close…</Text>}
      </Box>
    );
  }

  return (
    <Box key={resizeKey} flexDirection="column">
      {/* ── Scrolling log history ──────────────────────────────
          Rendered via <Static> so each line is permanently flushed
          to stdout above the live UI. The terminal's native scrollback owns
          full history; the in-memory array is bounded (appendBounded) to keep
          a long run from growing memory unboundedly, and <Static> is remounted
          on trim so it keeps flushing new lines past the cap. */}
      <Static key={`logs-${logTrimGeneration}`} items={logs}>
        {(line) => (
          <Text key={line.id}>
            <Text dimColor>{line.timestamp} </Text>
            {line.color ? <Text color={line.color}>{line.text}</Text> : line.text}
          </Text>
        )}
      </Static>

      <Box flexDirection="column" marginTop={0}>
        {(() => {
          const pause = coordRef.current?.getPause?.() ?? null;
          if (!pause) return null;
          const seconds = Math.floor((Date.now() - pause.since) / 1000);
          const duration =
            seconds < 60
              ? `${seconds}s`
              : seconds < 3600
                ? `${Math.floor(seconds / 60)}m`
                : `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
          return (
            <Box borderStyle="round" borderColor="red" paddingX={1} width={termWidth}>
              <Text color="red" bold>
                ⛔ BASELINE BROKEN {pause.issueIdentifier} · {duration} · `{pause.command}`
              </Text>
            </Box>
          );
        })()}

        {/* ── Settings header — two compact text lines ─────────── */}
        <AgentModeSettingsHeader
          version={VERSION}
          cfg={cfg}
          effective={effective}
          maxTickets={args.maxTickets}
          sysMetrics={sysMetrics}
          filterDesc={pollStatus.filterDesc}
          authedUser={authedUser}
          termWidth={termWidth}
        />

        {/* ── TASKS board — one lifecycle row per live ticket ─── */}
        {/* Gated (awaiting-confirmation) tickets render inline as `awaiting` rows. */}
        {!(cardFullScreen && focusedWorker) && (
          <AgentModeTasksBoard
            termWidth={termWidth}
            tasksLiveness={tasksLiveness}
            board={board}
            tree={tree}
            visibleTree={visibleTree}
            hiddenIdentifiers={hiddenIdentifiers}
            winStart={winStart}
            focusedRow={focusedRow}
            activeCount={activeCount}
            now={now}
            activeWorkers={activeWorkers}
            workerMetaRef={workerMetaRef}
          />
        )}

        {/* ── Focused ticket: full active card for a live worker, hidden in
            board full-screen so the board owns the whole terminal. */}
        {!boardFullScreen && focusedWorker && (
          <AgentModeWorkerCard
            worker={focusedWorker}
            workerMetaRef={workerMetaRef}
            coordRef={coordRef}
            now={now}
            termWidth={termWidth}
            spinnerFrame={spinnerFrame}
            focusedTailLines={focusedTailLines}
            showPendingTasks={showPendingTasks}
            showAllSubtasks={showAllSubtasks}
            steeringActive={steeringActive}
            steeringFocusedRef={steeringFocusedRef}
            steeringFocusedInitRef={steeringFocusedInitRef}
            steeringBufferRef={steeringBufferRef}
            steeringCursorRef={steeringCursorRef}
            tasksDir={tasksDir}
            appendSteering={appendSteering}
            fileEmit={fileEmit}
            appendLog={appendLog}
          />
        )}

        {/* Parked focused ticket — read-only card, no CMD / OUTPUT / steering.
            Hidden in full-screen so the board owns the whole terminal. */}
        {!boardFullScreen && !focusedWorker && focusedRow && (
          <AgentModeParkedCard row={focusedRow} now={now} termWidth={termWidth} />
        )}
      </Box>
      {awaitingClose && <Text color="cyan">Stopped — press Enter to close…</Text>}
    </Box>
  );
}
