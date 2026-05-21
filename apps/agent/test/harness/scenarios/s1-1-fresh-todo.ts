import type { ScenarioStep, SeedIssue } from "../types";

export interface ScenarioDefinition {
  name: string;
  seedIssues: SeedIssue[];
  transcript: ScenarioStep[];
}

export const s1_1_freshTodo: ScenarioDefinition = {
  name: "s1.1-fresh-todo",
  seedIssues: [
    {
      id: "issue-ex-1",
      identifier: "RLF-EX-1",
      title: "Example fresh todo",
      labels: ["ralphy:todo"],
      state: { name: "Todo", type: "unstarted" },
      priority: 2,
    },
  ],
  transcript: [
    { kind: "message", payload: "starting" },
    { kind: "diff", payload: "+ added a line\n" },
    { kind: "exit", payload: { code: 0 } },
  ],
};
