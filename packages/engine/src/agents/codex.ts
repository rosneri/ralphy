import { createCodexAdapter } from "@ralphy/adapter-codex";
import type { Agent, AgentRequest, AgentRunResult } from "./protocol";

export const codexAgent: Agent = {
  name: "codex",

  async run(req: AgentRequest): Promise<AgentRunResult> {
    const opts: Parameters<typeof createCodexAdapter>[0] = {
      model: req.model,
      prompt: req.prompt,
      onFeedEvent: req.onFeedEvent,
    };
    if (req.cwd !== undefined) opts.cwd = req.cwd;
    if (req.signal !== undefined) opts.signal = req.signal;
    if (req.resumeSessionId !== undefined) opts.resumeSessionId = req.resumeSessionId;
    if (req.onRawLine !== undefined) opts.onRawLine = req.onRawLine;
    return createCodexAdapter(opts);
  },
};
