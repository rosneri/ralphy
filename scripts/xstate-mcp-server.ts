#!/usr/bin/env bun
// Project-local xstate-mcp entry. The published `xstate-mcp` bin registers an
// empty machine list, so the MCP server can't see any of this repo's machines.
// This entry wires the real machines into the registry.
import { createXstateMcpServer } from "@rosneri/xstate-mcp";
import { exampleMachine, flowMachine, loopMachine } from "../packages/core/src/machines/index.ts";

await createXstateMcpServer([
  {
    name: "flow",
    description:
      "Issue lifecycle: idle → working → conflict-fix / ci-fix / awaiting / review / done / error.",
    machine: flowMachine,
  },
  {
    name: "loop",
    description:
      "Loop stop-condition guards: maxIterations, costCap, runtimeLimit, consecutiveFailures.",
    machine: loopMachine,
  },
  {
    name: "example",
    description: "Minimal idle ↔ active example machine.",
    machine: exampleMachine,
  },
]);
