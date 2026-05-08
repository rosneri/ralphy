/**
 * Core logic for `ralph debug --name <changeName>`.
 *
 * Reads the agent log and worker log, queries Linear for the current ticket
 * state, queries GitHub for the current PR state, and prints a merged timeline
 * plus a diagnosis of what went wrong.
 */

import { join } from "node:path";
import { AGENT_LOG_PATH } from "@ralphy/log";

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

export interface DebugLogLine {
  ts: Date;
  type: string;
  text: string;
}

const LOG_LINE_RE = /^\[(.+?)\] \[(.+?)\] (.+)$/;

export function parseLog(content: string): DebugLogLine[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const m = LOG_LINE_RE.exec(line);
      if (!m) return [];
      const ts = new Date(m[1]!);
      if (isNaN(ts.getTime())) return [];
      return [{ ts, type: m[2]!, text: m[3]! }];
    });
}

function fmtTs(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 23);
}

// ---------------------------------------------------------------------------
// Resolve changeName / issueIdentifier from the agent log
// ---------------------------------------------------------------------------

const SPAWN_RE = /▶ (\S+) → (\S+)/;

export async function resolveDebugTarget(opts: {
  name?: string;
  issue?: string;
}): Promise<{ changeName: string; identifier: string | undefined }> {
  const agentLogFile = Bun.file(AGENT_LOG_PATH);
  const agentLines = (await agentLogFile.exists()) ? parseLog(await agentLogFile.text()) : [];

  if (opts.name && !opts.issue) {
    for (const line of agentLines) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[2] === opts.name) return { changeName: opts.name, identifier: m[1] };
    }
    return { changeName: opts.name, identifier: undefined };
  }

  if (opts.issue && !opts.name) {
    for (const line of agentLines) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[1] === opts.issue) return { changeName: m[2]!, identifier: opts.issue };
    }
    return { changeName: opts.issue, identifier: opts.issue };
  }

  return { changeName: opts.name!, identifier: opts.issue };
}

// ---------------------------------------------------------------------------
// Linear query — identifier-based ("COD-42")
// ---------------------------------------------------------------------------

interface LinearIssueInfo {
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string }[] };
}

async function fetchLinearIssue(identifier: string): Promise<LinearIssueInfo | null> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return null;

  const query = `
    query($identifier: String!) {
      issues(filter: { identifier: { eq: $identifier } }, first: 1) {
        nodes {
          identifier title url
          state { name type }
          labels { nodes { name } }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables: { identifier } }),
    });
    const json = (await res.json()) as {
      data?: { issues?: { nodes?: LinearIssueInfo[] } };
    };
    return json.data?.issues?.nodes?.[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub PR query — uses gh CLI with array args (no shell interpolation)
// ---------------------------------------------------------------------------

interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  mergeable: string;
  checks: { name: string; state: string; conclusion: string | null }[];
}

function spawnGh<T>(args: string[]): T | null {
  const result = Bun.spawnSync(["gh", ...args], { stderr: "ignore" });
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout.toString()) as T;
  } catch {
    return null;
  }
}

async function fetchGithubPr(changeName: string): Promise<PrInfo | null> {
  const branch = `ralph/${changeName}`;

  const prs = spawnGh<
    { number: number; title: string; url: string; state: string; mergeable: string }[]
  >([
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "number,title,url,state,mergeable",
  ]);

  if (!prs?.length) return null;
  const pr = prs[0]!;

  const checks =
    spawnGh<{ name: string; state: string; conclusion: string | null }[]>([
      "pr",
      "checks",
      String(pr.number),
      "--json",
      "name,state,conclusion",
    ]) ?? [];

  return { ...pr, checks };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDebug(opts: {
  name?: string;
  issue?: string;
  projectRoot: string;
}): Promise<void> {
  const { projectRoot } = opts;

  const agentLogFile = Bun.file(AGENT_LOG_PATH);
  const agentLogContent = (await agentLogFile.exists()) ? await agentLogFile.text() : "";
  const agentLines = parseLog(agentLogContent);

  let { changeName, identifier: issueIdentifier } = await resolveDebugTarget({
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.issue !== undefined ? { issue: opts.issue } : {}),
  });

  if (!changeName) {
    process.stderr.write(
      `! Could not resolve a change name for ${opts.issue ?? opts.name}. Has this issue been started?\n`,
    );
    process.exit(1);
  }

  // Filter agent log to lines mentioning this change or issue
  const relevant = agentLines.filter(
    (l) =>
      l.text.includes(changeName) ||
      (issueIdentifier !== undefined && l.text.includes(issueIdentifier)),
  );

  // Try to extract identifier from spawn lines if not yet known
  if (!issueIdentifier) {
    for (const line of relevant) {
      const m = SPAWN_RE.exec(line.text);
      if (m && m[2] === changeName) {
        issueIdentifier = m[1];
        break;
      }
    }
  }

  // Worker log is already scoped to this change
  const workerLogPath = join(projectRoot, ".ralph", "logs", `${changeName}.log`);
  const workerLogFile = Bun.file(workerLogPath);
  const workerLines = (await workerLogFile.exists()) ? parseLog(await workerLogFile.text()) : [];

  // Merge + sort + deduplicate (phase events appear in both logs)
  const merged = [...relevant, ...workerLines].sort((a, b) => +a.ts - +b.ts);
  const seen = new Set<string>();
  const timeline = merged.filter((l) => {
    const key = `${l.ts.getTime()}:${l.type}:${l.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const out = (s: string) => process.stdout.write(s + "\n");

  // Timeline
  out(`\n=== Ralph Debug: ${changeName}${issueIdentifier ? ` (${issueIdentifier})` : ""} ===\n`);
  out("── Timeline ─────────────────────────────────────────────────────────");
  if (!timeline.length) {
    out("  (no log entries found)");
  } else {
    for (const line of timeline) {
      const prefix = line.type === "output" ? "  │" : "  ·";
      out(`${prefix} ${fmtTs(line.ts)}  [${line.type.padEnd(7)}]  ${line.text}`);
    }
  }
  out("");

  // Linear state
  out("── Current Linear state ─────────────────────────────────────────────");
  if (!issueIdentifier) {
    out("  (unknown identifier — pass --issue to query Linear directly)");
  } else if (!process.env.LINEAR_API_KEY) {
    out("  (set LINEAR_API_KEY to fetch current Linear state)");
  } else {
    const issue = await fetchLinearIssue(issueIdentifier);
    if (!issue) {
      out(`  ! Could not fetch ${issueIdentifier} from Linear`);
    } else {
      const labels = issue.labels.nodes.map((l) => l.name).join(", ") || "(none)";
      out(`  Title  : ${issue.title}`);
      out(`  Status : ${issue.state.name} (${issue.state.type})`);
      out(`  Labels : ${labels}`);
      out(`  URL    : ${issue.url}`);
    }
  }
  out("");

  // GitHub PR state
  out("── Current GitHub PR ────────────────────────────────────────────────");
  const pr = await fetchGithubPr(changeName);
  if (!pr) {
    out(`  (no PR found for branch ralph/${changeName})`);
  } else {
    const failing = pr.checks.filter(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "failure",
    );
    const pending = pr.checks.filter((c) => c.state === "PENDING" || c.state === "IN_PROGRESS");
    out(`  PR #${pr.number} : ${pr.url}`);
    out(`  State     : ${pr.state}`);
    out(`  Mergeable : ${pr.mergeable}`);
    if (pr.checks.length) {
      out(
        `  Checks    : ${pr.checks.length} total, ${failing.length} failing, ${pending.length} pending`,
      );
      for (const c of failing) out(`    ✗ ${c.name}`);
      for (const c of pending) out(`    ⧗ ${c.name}`);
    } else {
      out("  Checks    : (none or not yet available)");
    }
  }
  out("");

  // Diagnosis
  out("── Diagnosis ────────────────────────────────────────────────────────");

  const lastEvent = timeline.at(-1);
  if (lastEvent) out(`  Last event : ${fmtTs(lastEvent.ts)}  ${lastEvent.text}`);

  const exitLine = relevant.find((l) => /exited \(code \d+\)/.test(l.text));
  if (exitLine) {
    const code = Number(/code (\d+)/.exec(exitLine.text)?.[1]);
    const meaning =
      code === 0
        ? "success"
        : code === 70
          ? "CI fix loop exhausted its attempt budget"
          : code === 71
            ? "push or PR creation failed (pre-push hook or remote rejection)"
            : "worker subprocess failed";
    out(`  Exit code  : ${code} — ${meaning}`);
  }

  const logHas = (s: string) => relevant.some((l) => l.text.includes(s));

  if (logHas("setError applied")) out("  ⚠ setError applied — issue is quarantined in Linear");
  if (logHas("setDone applied")) out("  ✓ setDone applied — issue marked done in Linear");
  if (logHas("clearConflicted applied")) out("  ✓ clearConflicted applied — conflicts resolved");
  if (logHas("setConflicted applied")) out("  ⚠ setConflicted applied — merge conflicts detected");
  if (logHas("skipping PR phase")) out("  ↩ PR phase skipped — worker exited non-zero");

  if (pr?.mergeable === "CONFLICTING") out("  ⚠ PR currently has merge conflicts");
  if (pr?.checks.some((c) => c.conclusion === "FAILURE" || c.conclusion === "failure")) {
    out("  ⚠ PR has failing CI checks");
  }

  const worktreePath = join(projectRoot, ".ralph", "worktrees", changeName);
  const worktreeExists = await Bun.file(join(worktreePath, ".git")).exists();
  if (worktreeExists) out(`  Worktree   : ${worktreePath}`);

  if (!timeline.length) out("  (no log entries — has this change been started yet?)");

  out("");
}
