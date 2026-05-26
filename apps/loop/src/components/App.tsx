import { useEffect, type ReactNode } from "react";
import { join } from "node:path";
import { Text, useApp } from "ink";
import type { LoopParsedArgs } from "../cli";
import type { TaskPhase } from "../loop";
import { readState } from "@ralphy/core/state";
import { getStorage } from "@ralphy/context";
import { TaskStatus } from "./TaskStatus";
import { TaskLoop } from "./TaskLoop";
import { OpenSpecChangeStore } from "@ralphy/openspec";

interface AppProps {
  args: LoopParsedArgs;
  taskPhase?: TaskPhase;
  statesDir: string;
  tasksDir: string;
  projectRoot: string;
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
  taskPhase?: TaskPhase;
  statesDir: string;
  tasksDir: string;
}

function TaskModeWrapper({ args, taskPhase, statesDir, tasksDir }: TaskModeWrapperProps) {
  return (
    <TaskLoop
      opts={{
        name: args.name,
        prompt: args.prompt,
        engine: args.engine,
        model: args.model,
        maxIterations: args.maxIterations,
        maxCostUsd: args.maxCostUsd,
        maxRuntimeMinutes: args.maxRuntimeMinutes,
        maxConsecutiveFailures: args.maxConsecutiveFailures,
        delay: args.delay,
        log: args.log,
        verbose: args.verbose,
        manualTest: args.manualTest,
        createPr: args.fromAgent,
        statesDir,
        tasksDir,
        changeStore: new OpenSpecChangeStore(),
        ...(taskPhase !== undefined ? { phase: taskPhase } : {}),
        ...(args.reviewPhase.enabled ? { reviewPhase: args.reviewPhase } : {}),
      }}
    />
  );
}

export function App({ args, taskPhase, statesDir, tasksDir }: AppProps) {
  switch (args.mode) {
    case "status": {
      if (!args.name) {
        return <ErrorMessage message="Error: --name is required for status mode" />;
      }
      const stateDir = join(statesDir, args.name);
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
      // Directory creation is handled up front in index.ts / the sidecar; the
      // storage provider will create parents lazily on first write as well.
      return (
        <TaskModeWrapper
          args={args}
          {...(taskPhase !== undefined ? { taskPhase } : {})}
          statesDir={statesDir}
          tasksDir={tasksDir}
        />
      );
    }
  }
}
