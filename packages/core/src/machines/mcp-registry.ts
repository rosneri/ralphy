import type { AnyStateMachine } from "xstate";
import { exampleMachine } from "./example.machine";
import { flowMachine } from "./flow.machine";
import { loopMachine } from "./loop.machine";

/**
 * A machine exposed through the project-local xstate-mcp server.
 *
 * Structurally compatible with `@rosneri/xstate-mcp`'s `MachineEntry` so the
 * registry can be passed straight to `createXstateMcpServer`, but defined here
 * to avoid making `@rosneri/xstate-mcp` a runtime dependency of
 * `packages/core` (it is a root devDependency consumed only by scripts).
 */
export interface McpMachineEntry {
  readonly name: string;
  readonly description: string;
  readonly machine: AnyStateMachine;
  readonly supportsSimulation: boolean;
}

/**
 * Single source of truth for the machines exposed via xstate-mcp and exported
 * to `docs/state-machines/`. Add new top-level machines here.
 *
 * `supportsSimulation`:
 * - `flow` / `example` — simulatable from their initial state without input.
 * - `loop` — needs a constructed `START` event (options/startTime) and its
 *   `runtimeLimitReached` guard reads `Date.now()`, which throws in some
 *   sandboxes; inspection and diagram export still work.
 */
export const mcpMachineRegistry: readonly McpMachineEntry[] = [
  {
    name: "flow",
    description:
      "Issue lifecycle: idle → working → conflict-fix / ci-fix / awaiting / review / done / error.",
    machine: flowMachine,
    supportsSimulation: true,
  },
  {
    name: "loop",
    description:
      "Loop stop-condition guards: maxIterations, costCap, runtimeLimit, consecutiveFailures.",
    machine: loopMachine,
    supportsSimulation: false,
  },
  {
    name: "example",
    description: "Minimal idle ↔ active example machine.",
    machine: exampleMachine,
    supportsSimulation: true,
  },
];
