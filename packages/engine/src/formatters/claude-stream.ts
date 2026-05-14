import type { IterationUsage } from "@ralphy/types";
import type { FeedEvent, ToolInputSummary } from "../feed-events";

export interface ClaudeStreamState {
  turnCount: number;
  toolCount: number;
  gotResult: boolean;
  usage: IterationUsage | null;
}

function extractToolInputSummary(input: Record<string, unknown>): ToolInputSummary | undefined {
  if (typeof input.file_path === "string") {
    return { kind: "file", name: input.file_path.split("/").pop() ?? input.file_path };
  }
  if (typeof input.command === "string") {
    return { kind: "command", text: input.command.split("\n")[0] ?? input.command };
  }
  if (typeof input.pattern === "string") {
    const path =
      typeof input.path === "string" ? (input.path.split("/").pop() ?? input.path) : undefined;
    const summary: ToolInputSummary = { kind: "search", pattern: input.pattern };
    if (path) summary.path = path;
    return summary;
  }
  if (typeof input.query === "string") {
    return { kind: "search", pattern: input.query };
  }
  if (typeof input.url === "string") {
    return { kind: "url", url: input.url };
  }
  if (typeof input.prompt === "string") {
    return { kind: "prompt", text: input.prompt.split("\n")[0] ?? input.prompt };
  }
  if (input.old_string !== undefined) return { kind: "edit" };
  if (input.content !== undefined) return { kind: "write" };

  // Fallback: compact key=value pairs for MCP and other unknown tools
  const keys = Object.keys(input);
  if (keys.length === 0) return undefined;
  const parts: string[] = [];
  let len = 0;
  for (const k of keys) {
    const v = input[k];
    const val = typeof v === "string" ? v : JSON.stringify(v);
    const short = val.length > 40 ? val.slice(0, 40) + "…" : val;
    const part = `${k}=${short}`;
    if (len + part.length > 120) break;
    parts.push(part);
    len += part.length + 2;
  }
  return { kind: "raw", text: parts.join("  ") };
}

function extractUsage(event: Record<string, unknown>): IterationUsage {
  const usage = (event.usage ?? {}) as Record<string, number>;
  return {
    cost_usd: Math.round(((event.total_cost_usd as number) ?? 0) * 100) / 100,
    duration_ms: (event.duration_ms as number) ?? 0,
    num_turns: (event.num_turns as number) ?? 0,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Parse a single line of Claude stream-json output into structured FeedEvents.
 */
export function parseClaudeLine(line: string, state: ClaudeStreamState): FeedEvent[] {
  if (!line.trim()) return [];

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }

  const type = event.type as string | undefined;
  if (!type) return [];

  const events: FeedEvent[] = [];

  switch (type) {
    case "system": {
      const subtype = (event.subtype as string) ?? "";
      if (subtype === "init") {
        const model = (event.model as string) ?? "unknown";
        const sid = ((event.session_id as string) ?? "").slice(0, 8);
        if (model === "unknown") {
          events.push({ type: "session-unknown", sessionId: sid });
        } else {
          const se: Extract<FeedEvent, { type: "session" }> = {
            type: "session",
            model,
            sessionId: sid,
          };
          if (typeof event.claude_code_version === "string") se.version = event.claude_code_version;
          if (Array.isArray(event.tools)) se.toolCount = event.tools.length;
          events.push(se);
        }
      } else if (subtype === "task_started") {
        const desc = (event.description as string) ?? "";
        if (desc) events.push({ type: "agent", description: desc });
      }
      break;
    }

    case "assistant": {
      state.turnCount++;
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        const btype = block.type as string;
        if (btype === "text") {
          const text = block.text as string;
          if (text) events.push({ type: "text", text });
        } else if (btype === "tool_use") {
          state.toolCount++;
          const name = (block.name as string) ?? "?";
          const summary = extractToolInputSummary((block.input ?? {}) as Record<string, unknown>);
          const ev: Extract<FeedEvent, { type: "tool-start" }> = { type: "tool-start", name };
          if (summary) ev.summary = summary;
          events.push(ev);
        } else if (btype === "thinking") {
          const thinking = (block.thinking as string) ?? "";
          if (thinking) {
            const lines = thinking.split("\n");
            events.push({
              type: "thinking",
              preview: lines.slice(0, 3).join("\n"),
              totalLines: lines.length,
            });
          } else {
            events.push({ type: "thinking" });
          }
        }
      }
      break;
    }

    case "user": {
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if ((block.type as string) === "tool_result") {
          // Always emit tool-end first
          events.push({ type: "tool-end" });

          let resultText = "";
          const blockContent = block.content;
          if (typeof blockContent === "string") {
            resultText = blockContent;
          } else if (Array.isArray(blockContent)) {
            resultText = blockContent
              .filter((c: Record<string, unknown>) => (c.type as string) === "text")
              .map((c: Record<string, unknown>) => c.text as string)
              .join("\n");
          }
          if (resultText) {
            const lines = resultText.split("\n");
            const preview = lines.slice(0, 6);
            const ev: Extract<FeedEvent, { type: "tool-result-preview" }> = {
              type: "tool-result-preview",
              lines: preview,
            };
            if (lines.length > 6) ev.truncated = lines.length - 6;
            events.push(ev);
          }
        }
      }
      break;
    }

    case "result": {
      state.gotResult = true;
      const usage = extractUsage(event);
      state.usage = usage;

      const subtype = (event.subtype as string) ?? "unknown";
      if (subtype === "error") {
        const errmsg = (event.result as string) ?? "unknown error";
        events.push({ type: "result-error", message: errmsg });
      } else {
        events.push({
          type: "result",
          cost: usage.cost_usd,
          timeMs: usage.duration_ms,
          turns: usage.num_turns,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cached: usage.cache_read_input_tokens,
        });
      }
      break;
    }
  }

  return events;
}
