import type { ScenarioDefinition } from "./s1-1-fresh-todo";
import { s1_1_freshTodo } from "./s1-1-fresh-todo";

export const registry: Record<string, ScenarioDefinition> = {
  "s1.1-fresh-todo": s1_1_freshTodo,
};

export function getScenario(name: string): ScenarioDefinition {
  const s = registry[name];
  if (!s) {
    throw new Error("harness: unknown scenario", {
      cause: { name, registered: Object.keys(registry) },
    });
  }
  return s;
}
