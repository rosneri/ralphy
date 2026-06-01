#!/usr/bin/env bun
// Project-local xstate-mcp entry. The published `xstate-mcp` bin registers an
// empty machine list, so the MCP server can't see any of this repo's machines.
// This entry wires the real machines into the registry. The registry itself
// lives in `packages/core/src/machines/mcp-registry.ts` (single source of truth,
// also consumed by `scripts/export-state-diagrams.ts`).
import { createXstateMcpServer } from "@rosneri/xstate-mcp";
import { mcpMachineRegistry } from "../packages/core/src/machines/index.ts";

await createXstateMcpServer(mcpMachineRegistry);
