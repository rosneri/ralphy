import type { Engine } from "@ralphy/types";
import type { Agent } from "./protocol";
import { claudeAgent } from "./claude";
import { codexAgent } from "./codex";

export type { Agent, AgentRequest, AgentRunResult } from "./protocol";

export const AGENTS: Record<Engine, Agent> = {
  claude: claudeAgent,
  codex: codexAgent,
};

export function getAgent(name: Engine): Agent {
  const agent = AGENTS[name];
  if (!agent) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return agent;
}
