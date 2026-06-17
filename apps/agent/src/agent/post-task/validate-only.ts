import { join } from "node:path";
import { AGENT_TASKS_FILENAME, prependFixTask } from "@ralphy/core/tasks-md";
import { reactivateState } from "./respawn";
import type { PostTaskPhase } from "./types";

// ---------------------------------------------------------------------------
// Validate-only phase — runs after worker exits when `wantValidateOnly` is
// set. Runs configured check commands; on failure injects a fix task and
// respawns the worker. On success (or when no commands are configured)
// injects a "run openspec validate" task so the agent finalises the change.
// ---------------------------------------------------------------------------

interface ValidateOnlyInput {
  changeName: string;
  changeDir: string;
  stateFilePath: string;
  validateCommands: string[];
  cwd: string;
}

interface ValidateOnlyDeps {
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
  /**
   * Run a shell command string; resolve with exit code and combined output.
   * Defaults to `sh -c <cmd>` via Bun.spawnSync when not provided.
   */
  runCommand?: (cmd: string, cwd: string) => Promise<{ exitCode: number; output: string }>;
}

const defaultRunCommand = async (
  cmd: string,
  cwd: string,
): Promise<{ exitCode: number; output: string }> => {
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", cmd],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  const output = [decoder.decode(proc.stdout), decoder.decode(proc.stderr)]
    .filter(Boolean)
    .join("\n");
  return { exitCode: proc.exitCode ?? 1, output };
};

/**
 * Phase: validate-only.
 *
 * Runs when the agent app spawns a worker with `--validate-on-complete`
 * (i.e. `wantValidateOnly` is true) and the worker exits with code 0.
 *
 * 1. If `validateCommands` is empty → inject a "run openspec validate" task
 *    directly (straight to validation).
 * 2. Otherwise run each command in order:
 *    - First failure → emit `"validate-fix"`, inject a fix task, respawn.
 *    - All pass → inject the "run openspec validate" task, respawn.
 */
export async function runValidateOnlyPhase(
  input: ValidateOnlyInput,
  deps: ValidateOnlyDeps,
): Promise<number> {
  const { changeName, changeDir, stateFilePath, validateCommands, cwd } = input;
  const { log, emit, respawnWorker } = deps;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  emit("validate");

  if (validateCommands.length > 0) {
    for (const command of validateCommands) {
      const { exitCode, output } = await runCommand(command, cwd);
      if (exitCode !== 0) {
        emit("validate-fix", command);
        log(`! validation check failed: ${command}`, "yellow");
        try {
          await prependFixTask(
            join(changeDir, AGENT_TASKS_FILENAME),
            `Fix failing validation: ${command}`,
            output || `Command exited with code ${exitCode}`,
          );
        } catch (err) {
          log(`! could not prepend fix task: ${(err as Error).message}`, "red");
          return 1;
        }
        await reactivateState(stateFilePath, log, changeName);
        return respawnWorker();
      }
    }
  }

  // No commands, or all commands passed → inject the openspec validation task.
  try {
    await prependFixTask(
      join(changeDir, AGENT_TASKS_FILENAME),
      "Run openspec validation",
      [
        `Run \`bunx openspec validate ${changeName}\` to validate the change artifacts.`,
        `Commit any pending changes before running the validation command.`,
      ].join("\n"),
    );
  } catch (err) {
    log(`! could not prepend validation task: ${(err as Error).message}`, "red");
    return 1;
  }
  await reactivateState(stateFilePath, log, changeName);
  return respawnWorker();
}
