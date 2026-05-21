import type { ParsedArgs } from "./cli";

export function shouldFallbackToJsonOutput(
  args: Pick<ParsedArgs, "jsonOutput">,
  stdinIsTty: boolean | undefined,
): boolean {
  return !args.jsonOutput && stdinIsTty !== true;
}
