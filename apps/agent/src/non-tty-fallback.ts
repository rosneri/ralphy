import type { AgentParsedArgs } from "./cli";

export function shouldFallbackToJsonOutput(
  args: Pick<AgentParsedArgs, "jsonOutput">,
  stdinIsTty: boolean | undefined,
): boolean {
  return !args.jsonOutput && stdinIsTty !== true;
}
