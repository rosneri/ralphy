import type { CiStatus, CmdRunner, CodeHost } from "@ralphy/codehost";

/**
 * Resolve the status of a PR's CI checks. Thin delegation onto the injected
 * {@link CodeHost} (`@ralphy/codehost`), which owns the bucket classification,
 * the transient-failure retry policy, the "no checks reported" pass, and the
 * partial-access salvage. The adapter is built once at the entrypoint and
 * threaded in (issue #403 / RLF-255 9a) rather than re-constructed per call —
 * the bucket-classification config (`ignoreChecks`, `onTransientRetry`) lives
 * on that single instance.
 */
export async function getPrChecksStatus(prRef: string, codeHost: CodeHost): Promise<CiStatus> {
  return codeHost.getChecksStatus(prRef);
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
