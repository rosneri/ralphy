import { useEffect, type ReactNode } from "react";
import { join } from "node:path";
import { Text, useApp } from "ink";
import type { ResolvedConfig } from "@ralphy/config";
import type { LoopParsedArgs } from "../cli";
import type { TaskPhase } from "../loop";
import { readState } from "@ralphy/core/state";
import { getLayout, getStorage } from "@ralphy/context";
import { TaskStatus } from "./TaskStatus";
import { TaskLoop } from "./TaskLoop";
import { OpenSpecChangeStore } from "@ralphy/openspec";

interface AppProps {
  args: LoopParsedArgs;
  /** Boot-resolved config (WORKFLOW.md ⊕ CLI). Required for task mode. */
  resolved?: ResolvedConfig;
  taskPhase?: TaskPhase;
}

function ExitAfterRender({ children }: { children: ReactNode }) {
  const { exit } = useApp();
  useEffect(() => {
    exit();
  }, [exit]);
  return <>{children}</>;
}

function ErrorMessage({ message }: { message: string }) {
  const { exit } = useApp();
  useEffect(() => {
    process.exitCode = 1;
    exit();
  }, [exit]);
  return <Text color="red">{message}</Text>;
}

interface TaskModeWrapperProps {
  args: LoopParsedArgs;
  resolved: ResolvedConfig;
  taskPhase?: TaskPhase;
}

function TaskModeWrapper({ args, resolved, taskPhase }: TaskModeWrapperProps) {
  // Config-derived fields (engine, model, limits, …) come from the resolved
  // config — never from raw args. Only runtime injections are wired here.
  return (
    <TaskLoop
      opts={resolved.loopOptions({
        name: args.name,
        prompt: args.prompt,
        createPr: args.fromAgent,
        changeStore: new OpenSpecChangeStore(),
        reviewPhase: args.review,
        ...(args.trigger !== undefined ? { trigger: args.trigger } : {}),
        ...(taskPhase !== undefined ? { phase: taskPhase } : {}),
      })}
    />
  );
}

export function App({ args, resolved, taskPhase }: AppProps) {
  switch (args.mode) {
    case "status": {
      if (!args.name) {
        return <ErrorMessage message="Error: --name is required for status mode" />;
      }
      const layout = getLayout();
      const stateDir = layout.taskStateDir(args.name);
      if (getStorage().read(join(stateDir, ".ralph-state.json")) === null) {
        return <ErrorMessage message={`Error: change '${args.name}' not found`} />;
      }
      const state = readState(stateDir);
      return (
        <ExitAfterRender>
          <TaskStatus state={state} stateDir={stateDir} />
        </ExitAfterRender>
      );
    }

    case "init":
      return (
        <ExitAfterRender>
          <Text color="green">Initialized openspec directory</Text>
        </ExitAfterRender>
      );

    case "clean":
    case "debug":
      // Both handled in index.ts before render; should not reach here.
      return (
        <ExitAfterRender>
          <Text></Text>
        </ExitAfterRender>
      );

    case "task": {
      if (!args.name) {
        return <ErrorMessage message="Error: --name is required for task mode" />;
      }
      if (!resolved) {
        return <ErrorMessage message="Error: task mode needs a resolved config (internal)" />;
      }
      // Directory creation is handled up front in index.ts / the sidecar; the
      // storage provider will create parents lazily on first write as well.
      return (
        <TaskModeWrapper
          args={args}
          resolved={resolved}
          {...(taskPhase !== undefined ? { taskPhase } : {})}
        />
      );
    }
  }
}
