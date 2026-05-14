import { Box, Text } from "ink";
import type { State } from "@ralphy/types";

interface BannerProps {
  state: State;
  mode: string;
  isResume?: boolean;
  noExecute?: boolean;
  interactive?: boolean;
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  maxConsecutiveFailures?: number;
  iterationDelay?: number;
  promptFile?: string;
  taskPrompt?: string;
}

const SEPARATOR = "━".repeat(44);

export function Banner({ state, ...opts }: BannerProps) {
  const engineLabel = state.engine === "claude" ? `${state.engine} (${state.model})` : state.engine;
  const maxLabel =
    opts.maxIterations && opts.maxIterations > 0 ? String(opts.maxIterations) : "unlimited";

  const promptLines = opts.taskPrompt?.split("\n");
  const maxPromptLines = 6;

  return (
    <Box flexDirection="column">
      <Text color="gray">{SEPARATOR}</Text>
      <Text>
        {" "}
        <Text bold color="cyan">
          Ralph Loop
        </Text>
      </Text>
      <Text color="gray">{SEPARATOR}</Text>

      <Text>
        {" "}
        <Text bold>Mode:</Text>
        {"       "}
        {opts.mode}
        {opts.isResume && <Text dimColor> (resumed)</Text>}
      </Text>

      {opts.mode === "task" && (
        <Text>
          {" "}
          <Text bold>Task:</Text>
          {"       "}
          {state.name}
        </Text>
      )}

      <Text>
        {" "}
        <Text bold>Engine:</Text>
        {"     "}
        {engineLabel}
      </Text>
      <Text>
        {" "}
        <Text bold>Branch:</Text>
        {"     "}
        {state.metadata.branch ?? "main"}
      </Text>

      {opts.promptFile && (
        <Text>
          {" "}
          <Text bold>Prompt:</Text>
          {"     "}
          {opts.promptFile}
        </Text>
      )}

      {opts.interactive && (
        <Text>
          {" "}
          <Text bold>Interactive:</Text> yes (research+plan phases)
        </Text>
      )}

      <Text>
        {" "}
        <Text bold>No execute:</Text> {opts.noExecute ? "yes (research+plan only)" : "no"}
      </Text>
      <Text>
        {" "}
        <Text bold>Max iters:</Text>
        {"  "}
        {maxLabel}
      </Text>

      {opts.maxCostUsd !== undefined && opts.maxCostUsd > 0 && (
        <Text>
          {" "}
          <Text bold>Cost cap:</Text>
          {"   $"}
          {opts.maxCostUsd}
        </Text>
      )}
      {opts.maxRuntimeMinutes !== undefined && opts.maxRuntimeMinutes > 0 && (
        <Text>
          {" "}
          <Text bold>Runtime:</Text>
          {"    "}
          {opts.maxRuntimeMinutes} min
        </Text>
      )}
      {opts.maxConsecutiveFailures !== undefined && opts.maxConsecutiveFailures > 0 && (
        <Text>
          {" "}
          <Text bold>Fail limit:</Text> {opts.maxConsecutiveFailures} consecutive
        </Text>
      )}
      {opts.iterationDelay !== undefined && opts.iterationDelay > 0 && (
        <Text>
          {" "}
          <Text bold>Delay:</Text>
          {"      "}
          {opts.iterationDelay}s between runs
        </Text>
      )}

      {opts.mode === "task" && promptLines && (
        <>
          <Text color="gray">{SEPARATOR}</Text>
          <Text>
            {" "}
            <Text bold>Prompt:</Text>
          </Text>
          {promptLines.slice(0, maxPromptLines).map((line, i) => (
            <Text key={i}>
              {"  "}
              <Text color="gray">{line}</Text>
            </Text>
          ))}
          {promptLines.length > maxPromptLines && (
            <Text dimColor>
              {"  "}… ({promptLines.length - maxPromptLines} more lines)
            </Text>
          )}
        </>
      )}

      <Text color="gray">{SEPARATOR}</Text>
    </Box>
  );
}
