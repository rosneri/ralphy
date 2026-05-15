import { createHash } from "node:crypto";
import type { CmdRunner } from "./pr";
import type { GitRunner } from "./worktree";

export interface BaselineFailure {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  fingerprint: string;
}

export interface BaselineResult {
  ok: boolean;
  failures: BaselineFailure[];
  /** Stable identifier for the failing set — derived from the first failure
   *  (or empty when `ok`). Used to dedup the Linear ticket body. */
  fingerprint: string;
}

export interface RunBaselineInput {
  cmdRunner: CmdRunner;
  gitRunner: GitRunner;
  cwd: string;
  commands: string[];
  baseBranch: string;
  outputCharLimit: number;
}

/**
 * Run the configured baseline commands against a freshly-synced base branch.
 *
 * - Runs `git fetch` + `git reset --hard origin/<baseBranch>` against `cwd`
 *   to make sure the commands see the up-to-date trunk.
 * - Runs each command via `cmdRunner.run`. Any non-zero exit becomes a
 *   `BaselineFailure`. Output is truncated to `outputCharLimit`.
 * - Fingerprint is the SHA1 of `command + first non-empty stderr/stdout
 *   line`, sliced to 12 chars — stable across whitespace-only changes.
 *
 * Errors from the git step bubble up as a synthetic failure so callers can
 * decide whether to log + skip (transient git fault) versus pause.
 */
export async function runBaseline(input: RunBaselineInput): Promise<BaselineResult> {
  const { cmdRunner, gitRunner, cwd, commands, baseBranch, outputCharLimit } = input;

  if (commands.length === 0) {
    return { ok: true, failures: [], fingerprint: "" };
  }

  try {
    await gitRunner.run(["fetch", "origin", baseBranch], cwd);
    await gitRunner.run(["reset", "--hard", `origin/${baseBranch}`], cwd);
  } catch (err) {
    const e = err as Error & { stderr?: string };
    const failure: BaselineFailure = {
      command: `git checkout ${baseBranch}`,
      exitCode: -1,
      stdout: "",
      stderr: truncate(e.stderr ?? e.message, outputCharLimit),
      fingerprint: fingerprintFor(`git checkout ${baseBranch}`, e.stderr ?? e.message),
    };
    return {
      ok: false,
      failures: [failure],
      fingerprint: failure.fingerprint,
    };
  }

  const failures: BaselineFailure[] = [];
  for (const command of commands) {
    const parts = parseCommand(command);
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const r = await cmdRunner.run(parts, cwd);
      stdout = r.stdout;
      stderr = r.stderr;
    } catch (err) {
      const e = err as Error & { stderr?: string; stdout?: string; code?: number };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? e.message;
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
    if (exitCode !== 0) {
      failures.push({
        command,
        exitCode,
        stdout: truncate(stdout, outputCharLimit),
        stderr: truncate(stderr, outputCharLimit),
        fingerprint: fingerprintFor(command, stderr || stdout),
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    fingerprint: failures[0]?.fingerprint ?? "",
  };
}

function parseCommand(cmd: string): string[] {
  return cmd.trim().split(/\s+/);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n…(truncated ${text.length - limit} chars)`;
}

function fingerprintFor(command: string, output: string): string {
  const firstLine = (output || "").split("\n").find((l) => l.trim().length > 0) ?? "";
  return createHash("sha1").update(`${command}\n${firstLine.trim()}`).digest("hex").slice(0, 12);
}
