/**
 * Repo identity detection for `ralphy init`.
 *
 * The setup wizard uses this to discover the git repository it is running in —
 * the `origin` remote — and persist its identity into WORKFLOW.md so a repo can
 * be linked to a Linear team. Detection is best-effort: every failure path
 * (no git, no repo, no `origin`, unparseable remote) returns `null` rather than
 * throwing, so the wizard degrades gracefully to its remote-less flow.
 */

const GIT_DETECT_TIMEOUT_MS = 5_000;

export interface RepoIdentity {
  /** Raw origin remote URL, e.g. git@github.com:owner/name.git */
  remote: string;
  /** Host, e.g. github.com */
  host: string;
  /** Owner / org / group, e.g. owner (keeps nested groups for GitLab subgroups). */
  owner: string;
  /** Repository name without the trailing .git */
  name: string;
}

// scp-style remote: [user@]host:path — only valid when there is no `://`
// scheme (those go through the URL branch instead).
const SCP_RE = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
// URL remote: scheme://[user@]host[:port]/path
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/;

/**
 * Pure parser — no I/O. Returns the parsed identity, or `null` when `remoteUrl`
 * is not a recognisable git remote (e.g. a bare local path).
 *
 * Handles SSH/scp (`git@host:owner/name.git`), HTTPS/HTTP
 * (`https://host/owner/name.git`), and `ssh://git@host:port/owner/name.git`.
 * A trailing `.git` and trailing slashes are stripped; `owner` keeps any nested
 * path segments before the final `name` (so GitLab subgroups survive).
 */
export function parseRepoIdentity(remoteUrl: string): RepoIdentity | null {
  const remote = remoteUrl.trim();
  if (!remote) return null;

  // A `://` scheme is parsed strictly as a URL; otherwise try scp syntax. This
  // keeps `file:///path` (and other schemes that fail the URL shape) from being
  // misread as a scp `host:path`.
  const match = remote.includes("://") ? URL_RE.exec(remote) : SCP_RE.exec(remote);
  if (!match) return null;
  const host = match[1];
  let path = match[2];
  if (!host || !path) return null;

  // Strip a trailing `.git` and any surrounding trailing slashes.
  path = path
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;

  const name = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");
  if (!owner || !name) return null;

  return { remote, host, owner, name };
}

/**
 * Detect the current repo by reading `git remote get-url origin` (async, via
 * `Bun.spawn`). Returns `null` — never throws — when git is unavailable, the
 * directory is not a repo, there is no `origin` remote, or the remote does not
 * parse.
 */
export async function detectRepoIdentity(cwd?: string): Promise<RepoIdentity | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "remote", "get-url", "origin"],
      ...(cwd ? { cwd } : {}),
      stdout: "pipe",
      stderr: "ignore",
      timeout: GIT_DETECT_TIMEOUT_MS,
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) return null;
    return parseRepoIdentity(stdout.trim());
  } catch {
    return null;
  }
}
