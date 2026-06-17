import type { PostTaskPhase } from "./types";

/** Inputs consumed only by the teardown phase. */
interface TeardownPhaseInput {
  cwd: string;
  teardownScript: string | null;
}

/** Deps consumed only by the teardown phase. */
interface TeardownPhaseDeps {
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
}

/**
 * Phase 3 — teardown script.
 *
 * Runs after both the worker and any post-task CI/PR work, and after worktree
 * cleanup. Fires on both success and failure, so artifacts can be gathered and
 * local mutations rolled back regardless of outcome. Failures are logged and
 * never block the caller.
 */
export async function runTeardownPhase(
  input: TeardownPhaseInput,
  deps: TeardownPhaseDeps,
): Promise<void> {
  const { cwd, teardownScript } = input;
  const { runScript, log, emit } = deps;

  if (!teardownScript) return;

  emit("teardown", teardownScript);
  try {
    await runScript("teardown", teardownScript, cwd);
  } catch (err) {
    log(`! teardown script threw: ${(err as Error).message}`, "yellow");
  }
}
