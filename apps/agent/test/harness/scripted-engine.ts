import type { ScenarioStep } from "./types";

export interface EngineLike {
  next: () => Promise<ScenarioStep>;
  remaining: () => number;
}

export interface ScriptedEngineConfig {
  scenario: ScenarioStep[];
}

export function createScriptedEngine({ scenario }: ScriptedEngineConfig): EngineLike {
  let i = 0;
  return {
    next: async () => {
      if (i >= scenario.length) {
        throw new Error(
          `scripted-engine: transcript exhausted at step ${i} (scenario has ${scenario.length} steps)`,
        );
      }
      const step = scenario[i++];
      if (!step) {
        throw new Error(`scripted-engine: missing step at ${i - 1}`);
      }
      return step;
    },
    remaining: () => scenario.length - i,
  };
}
