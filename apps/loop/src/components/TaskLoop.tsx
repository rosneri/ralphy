import { useState, useRef, useMemo } from "react";
import { Box, Static, Text, useInput, useStdin } from "ink";
import { TextInput } from "@inkjs/ui";
import { Banner } from "./Banner";
import { IterationHeader } from "./IterationHeader";
import { FeedLine } from "./FeedLine";
import { StatusBar } from "./StatusBar";
import { StopMessage } from "./StopMessage";
import { useLoop, type LogEntry } from "../hooks/useLoop";
import { useTerminalSize } from "@ralphy/ui-shared/useTerminalSize";
import { useHoldToClose } from "@ralphy/ui-shared/useHoldToClose";
import { getLayout } from "@ralphy/context";
import type { LoopOptions } from "../loop";

interface TaskLoopProps {
  opts: LoopOptions;
}

type FeedItem = { id: string; kind: "banner" } | { id: string; kind: "entry"; entry: LogEntry };

function LogLine({ entry, verbose }: { entry: LogEntry; verbose?: boolean | undefined }) {
  switch (entry.kind) {
    case "iterationHeader":
      return <IterationHeader iteration={entry.iteration} time={entry.time} />;
    case "info":
      return <Text dimColor> {entry.text}</Text>;
    case "feed":
      return <FeedLine event={entry.event} verbose={verbose} />;
  }
}

/**
 * Navigate input history. Returns the value to display, or null if no change.
 */
export function navigateHistory(
  history: string[],
  currentIndex: number,
  direction: "up" | "down",
): { value: string; index: number } | null {
  if (history.length === 0) return null;

  if (direction === "up") {
    const nextIndex = currentIndex < history.length - 1 ? currentIndex + 1 : currentIndex;
    return { value: history[history.length - 1 - nextIndex]!, index: nextIndex };
  }
  const nextIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  return {
    value: nextIndex >= 0 ? history[history.length - 1 - nextIndex]! : "",
    index: nextIndex,
  };
}

/**
 * Process a submitted steering value: trim, add to history, and call onSubmit.
 * Returns true if the value was submitted, false if it was empty.
 */
export function processSteerSubmit(
  value: string,
  history: string[],
  onSubmit: (msg: string) => void,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  history.push(trimmed);
  onSubmit(trimmed);
  return true;
}

/**
 * Process key input for history navigation.
 * Returns updated state if navigation occurred, null otherwise.
 */
export function handleSteerKeyInput(
  key: { upArrow: boolean; downArrow: boolean },
  history: string[],
  currentIndex: number,
): { value: string; index: number } | null {
  const dir = key.upArrow ? ("up" as const) : key.downArrow ? ("down" as const) : null;
  if (!dir) return null;
  return navigateHistory(history, currentIndex, dir);
}

export function SteerInput({ onSubmit }: { onSubmit: (msg: string) => void }) {
  const [inputKey, setInputKey] = useState(0);
  const [defaultValue, setDefaultValue] = useState("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  useInput((_input, key) => {
    const result = handleSteerKeyInput(key, historyRef.current, historyIndexRef.current);
    if (result) {
      historyIndexRef.current = result.index;
      setDefaultValue(result.value);
      setInputKey((k) => k + 1);
    }
  });

  return (
    <Box>
      <Text dimColor>steer: </Text>
      <TextInput
        key={inputKey}
        defaultValue={defaultValue}
        onSubmit={(v) => {
          if (processSteerSubmit(v, historyRef.current, onSubmit)) {
            historyIndexRef.current = -1;
            setDefaultValue("");
            setInputKey((k) => k + 1);
          }
        }}
      />
    </Box>
  );
}

export function TaskLoop({ opts }: TaskLoopProps) {
  const loop = useLoop(opts);
  const { isRawModeSupported } = useStdin();
  const { resizeKey } = useTerminalSize();
  const bannerItem = useRef<FeedItem>({ id: "__banner__", kind: "banner" });
  // Capture stateDir once at mount — getLayout() uses AsyncLocalStorage which
  // is only set during the initial render (inside runWithContext). Re-renders
  // triggered by React state updates run outside that scope.
  const [stateDir] = useState(() => getLayout().taskStateDir(opts.name));

  const feedItems: FeedItem[] = useMemo(
    () => [
      bannerItem.current,
      ...loop.logLines.map((e) => ({ id: e.id, kind: "entry" as const, entry: e })),
    ],
    [loop.logLines],
  );

  // Shared with the agent TUI: on an abnormal stop (anything but a clean
  // "completed") the pane is held open so the StopMessage — the rate/usage
  // limit, failure, or other reason — stays readable until the operator presses
  // Enter. A clean finish, or a piped `--from-agent` worker with no TTY, closes
  // immediately.
  const { awaitingClose } = useHoldToClose({
    finished: !loop.isRunning,
    hold: loop.stopReason !== null && loop.stopReason !== "completed",
  });

  if (!loop.state) return null;

  return (
    <Box key={resizeKey} flexDirection="column">
      <Static items={feedItems}>
        {(item) => {
          if (item.kind === "banner") {
            return (
              <Banner
                key={item.id}
                state={loop.state!}
                mode="task"
                isResume={loop.isResume}
                maxIterations={opts.maxIterations}
                maxCostUsd={opts.maxCostUsd}
                maxRuntimeMinutes={opts.maxRuntimeMinutes}
                maxConsecutiveFailures={opts.maxConsecutiveFailures}
                iterationDelay={opts.delay}
                taskPrompt={opts.prompt || loop.state!.prompt}
              />
            );
          }
          return <LogLine key={item.id} entry={item.entry} verbose={opts.verbose} />;
        }}
      </Static>

      {loop.isRunning && (
        <>
          <StatusBar
            iteration={loop.iteration}
            costUsd={loop.state.usage.total_cost_usd}
            startedAt={loop.startedAt}
            engine={opts.engine}
            model={opts.model}
            isRunning
          />
          {isRawModeSupported && <SteerInput onSubmit={loop.steer} />}
        </>
      )}

      {!loop.isRunning && loop.stopReason && (
        <>
          <StatusBar
            iteration={loop.iteration}
            costUsd={loop.state.usage.total_cost_usd}
            startedAt={loop.startedAt}
            engine={opts.engine}
            model={opts.model}
            isRunning={false}
          />
          <StopMessage
            reason={loop.stopReason}
            state={loop.state}
            stateDir={stateDir}
            maxIterations={opts.maxIterations}
            maxCostUsd={opts.maxCostUsd}
            maxRuntimeMinutes={opts.maxRuntimeMinutes}
            consecutiveFailures={loop.consecutiveFailures}
          />
          {awaitingClose && <Text color="cyan">{"\n"}Press Enter to close…</Text>}
        </>
      )}
    </Box>
  );
}
