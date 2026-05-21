/**
 * Per-poll memo for `gh pr view <url> --json <fields>` calls.
 *
 * A single poll cycle can ask about the same PR URL from several scan
 * paths (conflict scan, code-review scan, PR-URL discovery). Without a
 * shared cache each path runs its own `gh` subprocess — wasteful when
 * the field list is identical and slow on GitHub-flaky networks.
 *
 * The memo is keyed by `url + "|" + sorted-fields-csv` so two calls with
 * the same field set collapse into one invocation while a different
 * field list still re-runs (the caller wants different data). Instances
 * are scoped to a single poll cycle — `buildAgentCoordinator` creates a
 * fresh `PollContext` via the `beforePoll` hook, so stale cache entries
 * from prior polls never bleed into the next one.
 *
 * Failure semantics: a rejected fetch is dropped from the memo so the
 * next call retries. This avoids permanently caching a transient gh /
 * network failure for the rest of the poll cycle.
 */

import type { CmdRunner } from "../../agent/pr";

export class PollContext {
  private readonly memo = new Map<string, Promise<unknown>>();

  /**
   * Run `gh pr view <url> --json <fields>` once per (url, fields) key
   * for the lifetime of this `PollContext` and return the parsed JSON.
   * Concurrent callers with the same key await the same in-flight
   * promise; cached promises are reused for sequential callers too.
   */
  fetchPrOnce(
    url: string,
    fields: readonly string[],
    runner: CmdRunner,
    cwd: string,
  ): Promise<unknown> {
    const key = `${url}|${[...fields].sort().join(",")}`;
    const existing = this.memo.get(key);
    if (existing) return existing;
    const pending = this.runGhView(url, fields, runner, cwd);
    this.memo.set(key, pending);
    pending.catch(() => {
      // Drop transient failures so the next caller retries instead of
      // re-using a cached rejected promise for the rest of the poll.
      if (this.memo.get(key) === pending) this.memo.delete(key);
    });
    return pending;
  }

  /** Drop all memoised entries. Used in tests. */
  clear(): void {
    this.memo.clear();
  }

  private async runGhView(
    url: string,
    fields: readonly string[],
    runner: CmdRunner,
    cwd: string,
  ): Promise<unknown> {
    const res = await runner.run(["gh", "pr", "view", url, "--json", fields.join(",")], cwd);
    const parsed: unknown = JSON.parse(res.stdout.trim() || "{}");
    return parsed;
  }
}
