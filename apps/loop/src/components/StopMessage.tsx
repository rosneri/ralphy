import { Box, Text } from "ink";
import type { State } from "@ralphy/types";
import type { StopReason } from "../loop";

interface StopMessageProps {
  reason: StopReason;
  state: State;
  stateDir: string;
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  consecutiveFailures: number;
}

export function StopMessage({
  reason,
  state,
  stateDir,
  maxIterations,
  maxCostUsd,
  maxRuntimeMinutes,
  consecutiveFailures,
}: StopMessageProps) {
  switch (reason) {
    case "completed": {
      return (
        <Box flexDirection="column">
          <Text>{"\n"}All tasks completed — change archived.</Text>
          <Text>See: {stateDir}/tasks.md</Text>
        </Box>
      );
    }
    case "maxIterations":
      return (
        <Text>
          {"\n"}Reached max iterations: {maxIterations}
        </Text>
      );
    case "costCap":
      return (
        <Text color="yellow" bold>
          {"\n"}Cost cap reached: ${state.usage.total_cost_usd.toFixed(2)} {">"}= ${maxCostUsd}{" "}
          limit
        </Text>
      );
    case "runtimeLimit":
      return (
        <Text color="yellow" bold>
          {"\n"}Runtime limit reached: {maxRuntimeMinutes} minute(s)
        </Text>
      );
    case "consecutiveFailures":
      return (
        <Text color="red" bold>
          {"\n"}Stopped: {consecutiveFailures} consecutive identical failures detected
        </Text>
      );
    case "rateLimited":
      return (
        <Text color="red" bold>
          {"\n"}Stopped: engine hit API rate/usage limit
        </Text>
      );
  }
}
