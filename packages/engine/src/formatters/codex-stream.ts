import { renderFeedEvent } from "../feed-events";
import { parseCodexLine, type CodexStreamState } from "@ralphy/adapter-codex/codex-stream";

export { parseCodexLine } from "@ralphy/adapter-codex/codex-stream";
export type { CodexStreamState } from "@ralphy/adapter-codex/codex-stream";

export interface CodexStreamOptions {
  verbose?: boolean;
}

export interface CodexStreamResult {
  rateLimited: boolean;
  printingText: boolean;
  pendingTools: number;
}

/**
 * Process a single line of Codex JSONL output.
 * Returns chalk-styled output lines (backward compatible).
 */
export function processCodexLine(
  line: string,
  state: CodexStreamState,
  options: CodexStreamOptions = {},
): string[] {
  const verbose = options.verbose ?? false;
  const events = parseCodexLine(line, state);

  const output: string[] = [];
  for (const event of events) {
    if (!verbose && event.type === "raw") continue;
    if (!verbose && event.type === "agent") continue;
    output.push(...renderFeedEvent(event, verbose));
  }

  return output;
}

/**
 * Format a complete Codex JSONL output.
 */
export function formatCodexStream(
  input: string,
  options: CodexStreamOptions = {},
): { output: string; result: CodexStreamResult } {
  const state: CodexStreamState = {
    printingText: false,
    rateLimited: false,
    pendingTools: 0,
  };

  const allOutput: string[] = [];
  for (const line of input.split("\n")) {
    const lines = processCodexLine(line, state, options);
    allOutput.push(...lines);
  }

  if (state.printingText) {
    allOutput.push("");
  }

  return {
    output: allOutput.join("\n"),
    result: {
      rateLimited: state.rateLimited,
      printingText: state.printingText,
      pendingTools: state.pendingTools,
    },
  };
}
