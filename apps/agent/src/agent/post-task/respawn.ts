import { join } from "node:path";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";
import { fsChange } from "../../shared/capabilities/fs-change";
import { runCapability } from "../../shared/capabilities/run-capability";
import type { PostTaskCtx } from "./types";

/**
 * The respawn tier is a separate stop authority from `loopMachine`: it caps
 * how many times the harness re-runs the worker to recover from a push
 * rejection, merge conflict, only-meta diff, or validation failure within a
 * SINGLE post-task pass, and guards that recovery never rewrites history. The
 * loop machine governs the outer iteration budget; this module governs the
 * inner fix-and-retry budget. Keep the two distinct — do not fold these limits
 * into `loopMachine`.
 */

type LogFn = (text: string, color?: string) => void;

/**
 * The loop sets state.status="completed" once tasks.md has no unchecked
 * items. A re-spawned worker would then exit immediately via the loop
 * machine's statusNotActive guard without ever reading the freshly-prepended
 * fix task. Reset to "active" so the new section gets picked up.
 */
export async function reactivateState(
  stateFilePath: string,
  log: LogFn,
  changeName: string,
): Promise<void> {
  const file = Bun.file(stateFilePath);
  if (!(await file.exists())) return;
  try {
    const stateObj = JSON.parse(await file.text()) as {
      status?: string;
      lastModified?: string;
    };
    if (stateObj.status !== "active") {
      stateObj.status = "active";
      stateObj.lastModified = new Date().toISOString();
      await Bun.write(stateFilePath, JSON.stringify(stateObj, null, 2) + "\n");
    }
  } catch (err) {
    log(`! could not reactivate state for ${changeName}: ${(err as Error).message}`, "yellow");
  }
}

/**
 * Prepend a fix task to tasks.md, reactivate the loop state so the worker
 * picks it up, and re-spawn the worker. Returns the worker's exit code.
 */
export async function runWorkerWithFixTask(
  ctx: PostTaskCtx,
  heading: string,
  body: string,
): Promise<number> {
  try {
    await runCapability(fsChange.prependTask, {
      tasksPath: join(ctx.changeDir, AGENT_TASKS_FILENAME),
      heading,
      failureOutput: body,
    });
  } catch (err) {
    ctx.log(`! could not prepend fix task: ${(err as Error).message}`, "red");
    return 1;
  }
  await reactivateState(ctx.stateFilePath, ctx.log, ctx.changeName);

  // Append-only history guard: snapshot HEAD before respawn and require the
  // post-respawn HEAD to be a descendant. This prevents a fix worker from
  // "fixing" a failure by reverting/rebasing/amending its own commits — the
  // failure mode that produced PRs whose diff silently lost work.
  let preHead = "";
  try {
    const r = await ctx.cmd.run(["git", "rev-parse", "HEAD"], ctx.cwd);
    preHead = r.stdout.trim();
  } catch (err) {
    ctx.log(`! could not snapshot HEAD before fix task: ${(err as Error).message}`, "yellow");
  }

  const code = await ctx.respawnWorker();

  if (preHead) {
    try {
      const r = await ctx.cmd.run(["git", "rev-parse", "HEAD"], ctx.cwd);
      const postHead = r.stdout.trim();
      if (postHead !== preHead) {
        let isAncestor = true;
        try {
          await ctx.cmd.run(["git", "merge-base", "--is-ancestor", preHead, postHead], ctx.cwd);
        } catch {
          isAncestor = false;
        }
        if (!isAncestor) {
          ctx.log(
            `! fix worker for "${heading}" rewrote history — pre=${preHead.slice(0, 8)} ` +
              `is not an ancestor of post=${postHead.slice(0, 8)}. Aborting and preserving ` +
              `worktree at ${ctx.cwd}.`,
            "red",
          );
          return 1;
        }
      }
    } catch (err) {
      ctx.log(
        `! could not verify append-only history after fix task: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  return code;
}
