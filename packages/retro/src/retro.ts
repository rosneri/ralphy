import { dispositionFromExitCode } from "./disposition";
import { resolveRetroOutputPath } from "./paths";
import { buildRetroPrompt } from "./prompt";
import type { RetroContext, RetroDeps, RetroResult } from "./types";

export type { RetroContext, RetroDeps, RetroResult, RetroDisposition } from "./types";
export { dispositionFromExitCode } from "./disposition";
export { retroDir, resolveRetroOutputPath } from "./paths";
export { buildRetroPrompt } from "./prompt";

/**
 * Run a one-shot retrospective for a finished ticket. Opt-in (`--agent-debug`):
 * the agent app injects `deps`. Steps:
 *
 *  1. Compute the disposition + dedupe key; skip if already seen this run.
 *  2. Resolve the output path (versioned on clash).
 *  3. Build the prompt and drive the engine (read-only; the prompt forbids
 *     git/PR side effects).
 *  4. Verify the report exists on disk; log the outcome.
 *
 * Never throws — any failure is logged and reported as `{ written: false }` so
 * a debugging pass can never tear down the surrounding post-task flow.
 */
export async function runRetrospective(ctx: RetroContext, deps: RetroDeps): Promise<RetroResult> {
  const { log, runEngine, seen } = deps;
  const disposition = dispositionFromExitCode(ctx.exitCode);

  const key = `${ctx.identifier}:${disposition}:${ctx.date}`;
  if (seen.has(key)) {
    log(`  retrospective skipped for ${ctx.identifier} (already generated this run)`, "gray");
    return { written: false, skipped: "duplicate", disposition };
  }
  seen.add(key);

  try {
    const outputPath = await resolveRetroOutputPath(ctx.identifier, ctx.date);
    const prompt = buildRetroPrompt(ctx, outputPath);

    log(`  running retrospective for ${ctx.identifier} (${disposition}) → ${outputPath}`, "cyan");
    await runEngine({
      engine: ctx.engine,
      model: ctx.model,
      prompt,
      cwd: ctx.cwd,
      onOutput: (l) => log(l, "gray"),
    });

    const written = await Bun.file(outputPath).exists();
    if (written) {
      log(`  retrospective written: ${outputPath}`, "green");
    } else {
      log(`! retrospective engine finished but no report was written at ${outputPath}`, "yellow");
    }
    return { written, outputPath, disposition };
  } catch (err) {
    log(`! retrospective failed for ${ctx.identifier}: ${(err as Error).message}`, "yellow");
    return { written: false, disposition };
  }
}
