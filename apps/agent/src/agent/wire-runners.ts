import type { CmdRunner } from "./pr";
import type { GitRunner } from "./worktree";

export const bunGitRunner: GitRunner = {
  run: async (args, cwd) => {
    const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = new Error("git command failed") as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

export const bunCmdRunner: CmdRunner = {
  run: async (cmd, cwd) => {
    const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const firstStderrLine = stderr.trim().split("\n")[0] ?? "";
      const summary = firstStderrLine ? `: ${firstStderrLine}` : "";
      const err = new Error(`\`${cmd.join(" ")}\` exited ${code}${summary}`) as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

/**
 * Side-effect runners. Production wires bun-spawned git / generic command
 * processes; tests inject in-memory fakes so an end-to-end integration
 * suite never spawns a real subprocess. Provide whatever you want to
 * stub; anything you omit falls back to the bun-based default.
 */
export interface AgentRunners {
  git?: GitRunner;
  cmd?: CmdRunner;
  /** Spawn the actual `ralph task` worker subprocess. Default: Bun.spawn. */
  spawnWorker?: (cmd: string[], cwd: string) => { exited: Promise<number>; kill: () => void };
  /** Run a shell script (setup/teardown). Returns exit code; never throws. */
  runScript?: (cmd: string, cwd: string) => Promise<number>;
}

/**
 * Wrap a CmdRunner so each call emits start/end events. The dashboard
 * uses these to surface "currently running `gh pr checks`…" so a hung
 * external command is immediately visible (e.g. GitHub 504 hangs).
 */
export function traceCmdRunner(
  base: CmdRunner,
  onStart: (cmd: string[]) => void,
  onEnd: (cmd: string[], durationMs: number, ok: boolean) => void,
): CmdRunner {
  return {
    run: async (cmd, cwd) => {
      const t0 = Date.now();
      onStart(cmd);
      try {
        const r = await base.run(cmd, cwd);
        onEnd(cmd, Date.now() - t0, true);
        return r;
      } catch (err) {
        onEnd(cmd, Date.now() - t0, false);
        throw err;
      }
    },
  };
}
