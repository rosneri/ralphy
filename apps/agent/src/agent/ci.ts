import { createGhCliCodeHost, type CiStatus, type CmdRunner } from "@ralphy/codehost";

/**
 * Resolve the status of a PR's CI checks. Thin delegation onto the
 * {@link CodeHost} adapter (`@ralphy/codehost`), which owns the bucket
 * classification, the transient-failure retry policy, the "no checks
 * reported" pass, and the partial-access salvage. Kept as a function so the
 * many existing call sites (post-task, pr-discovery, watch loops) keep their
 * signature.
 */
export async function getPrChecksStatus(
  prRef: string,
  runner: CmdRunner,
  cwd: string,
  onTransientRetry?: (attempt: number, delayMs: number, reason: string) => void,
  ignoreCiChecks: string[] = [],
): Promise<CiStatus> {
  const host = createGhCliCodeHost({
    cmdRunner: runner,
    cwd,
    ignoreChecks: ignoreCiChecks,
    ...(onTransientRetry ? { onTransientRetry } : {}),
  });
  return host.getChecksStatus(prRef);
}

/** Fetch the failure logs for a set of workflow runs, truncated. */
export async function fetchFailedRunLogs(
  runIds: string[],
  runner: CmdRunner,
  cwd: string,
  maxCharsPerRun = 4000,
): Promise<string> {
  const chunks: string[] = [];
  for (const id of runIds) {
    try {
      const r = await runner.run(["gh", "run", "view", id, "--log-failed"], cwd);
      const text = r.stdout.trim();
      const truncated =
        text.length > maxCharsPerRun
          ? text.slice(0, maxCharsPerRun) + `\n…[truncated ${text.length - maxCharsPerRun} chars]`
          : text;
      chunks.push(`--- run ${id} ---\n${truncated}`);
    } catch (err) {
      chunks.push(`--- run ${id} ---\n(failed to fetch logs: ${(err as Error).message})`);
    }
  }
  return chunks.join("\n\n");
}
