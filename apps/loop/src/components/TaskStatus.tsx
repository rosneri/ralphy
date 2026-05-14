import { join } from "node:path";
import { Box, Text } from "ink";
import type { State } from "@ralphy/types";
import { getStorage } from "@ralphy/context";

interface TaskStatusProps {
  state: State;
  stateDir: string;
}

const HEAVY_RULE = "============================================";
const LIGHT_RULE = "--------------------------------------------";

const OPENSPEC_ARTIFACTS = ["proposal.md", "design.md", "tasks.md"];

export function TaskStatus({ state, stateDir }: TaskStatusProps) {
  const storage = getStorage();

  const cost = Math.round(state.usage.total_cost_usd * 100) / 100;
  const time = Math.round((state.usage.total_duration_ms / 1000) * 10) / 10 + "s";

  const artifacts = OPENSPEC_ARTIFACTS.map((name) => ({
    name,
    exists: storage.read(join(stateDir, name)) !== null,
  }));

  const recent = state.history.slice(-10);

  return (
    <Box flexDirection="column">
      <Text>{HEAVY_RULE}</Text>
      <Text> Change Status: {state.name}</Text>
      <Text>{HEAVY_RULE}</Text>
      <Text> Status: {state.status}</Text>
      <Text> Iteration: {state.iteration}</Text>
      <Text>
        {" "}
        Engine: {state.engine} ({state.model})
      </Text>
      <Text> Created: {state.createdAt}</Text>
      <Text> Last modified: {state.lastModified}</Text>
      <Text> Branch: {state.metadata.branch ?? "—"}</Text>
      <Text>{LIGHT_RULE}</Text>

      <Text> Usage:</Text>
      <Text> Cost: ${cost}</Text>
      <Text> Time: {time}</Text>
      <Text> Turns: {state.usage.total_turns}</Text>
      <Text> Input tokens: {state.usage.total_input_tokens}</Text>
      <Text> Output tokens: {state.usage.total_output_tokens}</Text>
      <Text> Cached tokens: {state.usage.total_cache_read_input_tokens}</Text>
      <Text>{LIGHT_RULE}</Text>

      <Text> Artifacts:</Text>
      {artifacts.map((artifact) => (
        <Text key={artifact.name}>
          {" "}
          {artifact.exists ? "[x]" : "[ ]"} {artifact.name}
        </Text>
      ))}

      <Text>{LIGHT_RULE}</Text>
      <Text> History (last 10):</Text>
      {recent.map((entry, index) => (
        <Text key={index}>
          {"   "}
          {entry.timestamp} | iter {entry.iteration} | {entry.engine}/{entry.model} | {entry.result}
        </Text>
      ))}
      <Text>{HEAVY_RULE}</Text>
    </Box>
  );
}
