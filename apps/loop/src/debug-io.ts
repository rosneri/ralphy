/**
 * Real I/O boundary for `ralph debug` (see debug.ts).
 *
 * Every side-effecting dependency runDebug needs — log/file reads, the Linear
 * GraphQL query, the `gh` CLI PR lookups, and the installed-binary probe — lives
 * here behind the `DebugIo` interface so debug.ts stays pure and unit-testable
 * with an injected fake. `defaultDebugIo` wires the production implementations.
 */

import { join } from "node:path";
import { AGENT_LOG_PATH } from "@ralphy/log";

export interface BinaryInfo {
  path: string;
  embeddedVersion: string | undefined;
  builtAt: Date | undefined;
}

export interface LinearIssueInfo {
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string }[] };
}

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  mergeable: string;
  checks: { name: string; state: string; conclusion: string | null }[];
}

/** The full set of side effects runDebug depends on, injected for testing. */
export interface DebugIo {
  /** Returns file text, or null when the file does not exist. */
  readOptionalText(path: string): Promise<string | null>;
  /** True when the path exists on disk. */
  pathExists(path: string): Promise<boolean>;
  inspectBinary(projectRoot: string): Promise<BinaryInfo | null>;
  fetchLinearIssue(identifier: string): Promise<LinearIssueInfo | null>;
  fetchGithubPr(changeName: string): Promise<PrInfo | null>;
  fetchMergeableNow(prUrl: string): string | null;
  /** Process-level Linear API key, or undefined when unset. */
  linearApiKey(): string | undefined;
  /** Absolute path to the shared agent text log. */
  agentLogPath(): string;
  /** Write one line to stdout. */
  out(line: string): void;
  /** Write one line to stderr. */
  errOut(line: string): void;
  /** Terminate the process with the given exit code. */
  exit(code: number): never;
}

async function readOptionalText(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : null;
}

async function pathExists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

async function inspectBinary(projectRoot: string): Promise<BinaryInfo | null> {
  const binPath = join(projectRoot, ".ralph", "bin", "cli.js");
  const file = Bun.file(binPath);
  if (!(await file.exists())) return null;

  let embeddedVersion: string | undefined;

  // Read a slice of the binary to find the embedded version string
  try {
    const slice = await file.slice(0, 50_000).text();
    const m = /"(\d+\.\d+\.\d+)"/.exec(slice);
    if (m) embeddedVersion = m[1];
  } catch {
    // binary might not be text-readable
  }

  let builtAt: Date | undefined;
  try {
    const r = Bun.spawnSync(["stat", "-f", "%Sm", "-t", "%Y-%m-%dT%H:%M:%S", binPath], {
      stderr: "ignore",
    });
    const s = r.stdout.toString().trim();
    if (s) builtAt = new Date(s);
  } catch {
    // ignore
  }

  return { path: binPath, embeddedVersion, builtAt };
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

function fetchMergeableNow(prUrl: string): string | null {
  const result = Bun.spawnSync(
    ["gh", "pr", "view", prUrl, "--json", "mergeable", "--jq", ".mergeable"],
    { stderr: "ignore" },
  );
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

/** Production wiring of every side effect runDebug performs. */
export const defaultDebugIo: DebugIo = {
  readOptionalText,
  pathExists,
  inspectBinary,
  fetchLinearIssue,
  fetchGithubPr,
  fetchMergeableNow,
  linearApiKey: () => process.env.LINEAR_API_KEY,
  agentLogPath: () => AGENT_LOG_PATH,
  out: (line) => process.stdout.write(line + "\n"),
  errOut: (line) => process.stderr.write(line),
  exit: (code) => process.exit(code),
};
