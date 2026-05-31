import type { CmdRunner } from "../pr";
import { escapeRegex } from "../wire/task-bodies";

interface GitHubPrRow {
  url: string;
  state: string;
  headRefName: string;
  title: string;
  updatedAt?: string;
}

/**
 * Resolve a PR URL for a Linear issue by searching GitHub. Runs
 * `gh pr list --search "<identifier> in:title" --state all` and accepts
 * any row whose title OR `headRefName` contains the identifier as a whole
 * word. Word-boundary matching on both fields prevents cross-linking an
 * issue to an unrelated ticket's PR (e.g. `RLF-7` must not match a
 * `rlf-70-…` branch). When several rows match, OPEN PRs are preferred;
 * among rows of equal openness the most recently updated wins.
 *
 * Returns null on no match or any `gh` failure.
 */
export async function discoverPrUrlFromGitHub(
  identifier: string,
  runner: CmdRunner,
  cwd: string,
  onLog?: (msg: string, color?: string) => void,
): Promise<string | null> {
  if (!identifier) return null;
  let rows: GitHubPrRow[];
  try {
    const res = await runner.run(
      [
        "gh",
        "pr",
        "list",
        "--search",
        `${identifier} in:title`,
        "--state",
        "all",
        "--json",
        "url,state,headRefName,title,updatedAt",
      ],
      cwd,
    );
    const text = res.stdout.trim();
    rows = text ? (JSON.parse(text) as GitHubPrRow[]) : [];
  } catch (err) {
    onLog?.(`! gh pr list (${identifier}) failed: ${(err as Error).message}`, "yellow");
    return null;
  }
  const idRe = new RegExp(`\\b${escapeRegex(identifier)}\\b`, "i");
  const matches = rows.filter(
    (r) => Boolean(r.url) && (idRe.test(r.title ?? "") || idRe.test(r.headRefName ?? "")),
  );
  if (matches.length === 0) return null;
  const open = matches.filter((r) => r.state === "OPEN");
  const pool = open.length > 0 ? open : matches;
  pool.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return pool[0]?.url ?? null;
}

interface PrUrlCacheEntry {
  url: string | null;
  fetchedAt: number;
}

interface PrUrlCache {
  /** Returns cached url (possibly null for a cached "no PR"), or
   *  `undefined` when the key is missing/expired and must be recomputed. */
  get(issueId: string): string | null | undefined;
  set(issueId: string, url: string | null): void;
  invalidate(issueId: string): void;
}

/**
 * Per-issue PR URL cache with a TTL. Negative results (null) are cached
 * too — issues with no PR yet are the bulk of the savings. Reads are
 * lazy: an expired entry returns `undefined` and is evicted.
 */
export function createPrUrlCache(ttlMs = 5 * 60 * 1000, now: () => number = Date.now): PrUrlCache {
  const map = new Map<string, PrUrlCacheEntry>();
  return {
    get(issueId) {
      const e = map.get(issueId);
      if (!e) return undefined;
      if (now() - e.fetchedAt >= ttlMs) {
        map.delete(issueId);
        return undefined;
      }
      return e.url;
    },
    set(issueId, url) {
      map.set(issueId, { url, fetchedAt: now() });
    },
    invalidate(issueId) {
      map.delete(issueId);
    },
  };
}
