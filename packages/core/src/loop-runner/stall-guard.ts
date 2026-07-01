import { countUncheckedTasks } from "../loop";

/**
 * ponytail: stall guard for the loop runner. If the unchecked-task count never
 * drops for N consecutive iterations the loop is wedged (context thrash, a stuck
 * engine) and respawning just burns iterations — this is what let a real run rack
 * up 43 no-op iterations before its cap. RALPHY_STALL_ITERATIONS tunes N
 * (default 3); 0 disables. Signature-only (ignores commits): a genuinely
 * progressing task checks off a box within N iterations; a thrashing one never
 * does.
 *
 * The returned closure is called once per iteration with the current unchecked
 * count. It returns the limit (for the stop message) once that many consecutive
 * no-drop iterations have elapsed, else null.
 */
/** Human-readable "N unchecked items remaining" line for a mission/agent tasks pair. */
export function formatRemainingLine(
  tasksContent: string,
  agentTasksContent: string | null,
): string {
  const item = (n: number): string => `${n} unchecked item${n === 1 ? "" : "s"} remaining`;
  const parts = [`tasks.md: ${item(countUncheckedTasks(tasksContent))}`];
  if (agentTasksContent !== null) {
    parts.push(`agent-tasks.md: ${item(countUncheckedTasks(agentTasksContent))}`);
  }
  return parts.join(" · ");
}

export function createStallGuard(): (remaining: number) => number | null {
  const limit = Number(Bun.env.RALPHY_STALL_ITERATIONS ?? 3);
  let prev = -1;
  let count = 0;
  return (remaining: number): number | null => {
    if (limit <= 0) return null;
    if (remaining === prev) {
      if (++count >= limit) return limit;
    } else {
      count = 0;
    }
    prev = remaining;
    return null;
  };
}
