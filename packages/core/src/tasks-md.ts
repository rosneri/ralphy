/**
 * Operations on a `tasks.md` / `agent-tasks.md` file. The format is
 * loose Markdown:
 *
 *   ## Section heading
 *
 *   - [ ] Unchecked task
 *   - [x] Completed task
 *
 * Per change directory there are two parallel files:
 *
 *  - `tasks.md`        — user-visible mission tasks. Drives the
 *                        dashboard's SUBTASKS panel.
 *  - `agent-tasks.md`  — internal flow tasks (CI repair, push reject,
 *                        merge conflicts, reviewer comments, @ralphy
 *                        mentions). Invisible to the dashboard.
 *
 * The loop's worker reads the *first* `## ` section that has unchecked
 * items and works on it until the items are ticked off. Anything that
 * mutates either file from outside the worker (the agent's hook-fix
 * and CI-fix retry paths) must respect that ordering — new fix sections
 * go *above* existing ones, otherwise the loop chews on stale tasks and
 * never sees the fix.
 *
 * This module is the single source of truth for those rules.
 */

import { join } from "node:path";

/** Filename used for user-visible mission tasks. */
export const MISSION_TASKS_FILENAME = "tasks.md";
/** Filename used for internal flow tasks (CI fix, push reject, …). */
export const AGENT_TASKS_FILENAME = "agent-tasks.md";

/**
 * Canonical heading prefixes used by `prependFixTask` callers to label
 * a flow task. Used both for routing decisions and for legacy
 * compatibility (filtering older `tasks.md` files that still contain
 * flow sections inline).
 *
 * Match by prefix after stripping any trailing ` (<ISO-timestamp>)`
 * suffix that `prependFixTask` appends — see `isFlowTaskHeading`.
 */
export const FLOW_TASK_HEADING_PREFIXES: readonly string[] = [
  "Fix failing CI checks",
  "Fix push rejection",
  "Resolve PR merge conflicts",
  "Resolve merge conflict with origin/",
  "Address reviewer comments",
  "Address GitHub @ralphy mention",
  "Address Linear @ralphy mention",
];

/**
 * Return true when `heading` is a known flow-task section heading.
 *
 * Accepts either the bare prefix (e.g. `Fix failing CI checks`) or the
 * timestamped form prepended by `prependFixTask`
 * (e.g. `Fix failing CI checks (2026-05-15T12:00:00.000Z)`).
 */
export function isFlowTaskHeading(heading: string): boolean {
  const stripped = heading.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return FLOW_TASK_HEADING_PREFIXES.some((p) => stripped.startsWith(p));
}

/**
 * Return the first `## ` section that still has at least one `- [ ]`
 * item. Falls back to the whole trimmed file when the file has no
 * `## ` headings but does have unchecked items (a flat top-level
 * checklist). Returns `null` when nothing is unchecked.
 */
export function firstUnchecked(tasksContent: string): string | null {
  const sections = tasksContent.split(/(?=^## )/m);
  for (const section of sections) {
    if (/^## /m.test(section) && /^- \[ \]/m.test(section)) return section.trim();
  }
  if (/^- \[ \]/m.test(tasksContent)) return tasksContent.trim();
  return null;
}

/** Count `- [ ]` items in the file. */
export function countUnchecked(tasksContent: string): number {
  return (tasksContent.match(/^- \[ \]/gm) ?? []).length;
}

/** True when there are no `- [ ]` items left. */
export function allCompleted(tasksContent: string): boolean {
  return !/^- \[ \]/m.test(tasksContent);
}

/**
 * Pure transform: insert a new `## ` section before the first existing
 * `## ` heading. Preserves any leading content (e.g. a `# Tasks for X`
 * title block). When the file has no existing sections, the new section
 * is appended after the existing content.
 */
export function prependSection(existing: string, heading: string, body: string): string {
  const section = `## ${heading}\n\n${body.trimEnd()}\n\n`;
  const headingIdx = existing.search(/^## /m);
  if (headingIdx === -1) {
    return existing.trimEnd() + (existing ? "\n\n" : "") + section;
  }
  return existing.slice(0, headingIdx) + section + existing.slice(headingIdx);
}

/**
 * Read `tasksPath`, prepend a new fix section (with `failureOutput`
 * inlined as a fenced code block under the unchecked task), and write
 * back. Used by the agent's hook-fix / CI-fix retry paths to feed
 * failure output back into the worker as the next task to tackle.
 *
 * Callers pick the target file: pass `agent-tasks.md` for internal
 * flow tasks, `tasks.md` for mission tasks (the latter is reserved for
 * the planning pass; flow tasks must not land there).
 */
export async function prependFixTask(
  tasksPath: string,
  heading: string,
  failureOutput: string,
): Promise<void> {
  const file = Bun.file(tasksPath);
  const existing = (await file.exists()) ? await file.text() : "";
  const stamped = `${heading} (${new Date().toISOString()})`;
  const fence = "```";
  const body =
    `- [ ] ${heading}. Read the error block below, fix the underlying ` +
    `problem (do not just retry the failing command), then check this box.\n\n` +
    `${fence}\n${failureOutput.trim()}\n${fence}`;
  await Bun.write(tasksPath, prependSection(existing, stamped, body));
}

/**
 * One side of an active-tasks lookup: the path that the loop should
 * point the worker at, and the file's current text.
 */
export interface ActiveTasksFile {
  /** Filename relative to the change directory. */
  filename: typeof MISSION_TASKS_FILENAME | typeof AGENT_TASKS_FILENAME;
  /** Absolute path passed to the worker prompt. */
  path: string;
  /** Current file contents. */
  content: string;
}

/**
 * Return the file the loop should read for the next worker iteration.
 *
 * Prefers `agent-tasks.md` when it exists and contains `- [ ]` items so
 * internal flow tasks (CI repair, push reject, …) always preempt
 * mission work. Falls back to `tasks.md`. Returns `null` only when
 * neither file exists.
 */
export async function pickActiveTasksFile(changeDir: string): Promise<ActiveTasksFile | null> {
  const agentPath = join(changeDir, AGENT_TASKS_FILENAME);
  const agentFile = Bun.file(agentPath);
  if (await agentFile.exists()) {
    const agentContent = await agentFile.text();
    if (/^- \[ \]/m.test(agentContent)) {
      return { filename: AGENT_TASKS_FILENAME, path: agentPath, content: agentContent };
    }
  }
  const missionPath = join(changeDir, MISSION_TASKS_FILENAME);
  const missionFile = Bun.file(missionPath);
  if (await missionFile.exists()) {
    return {
      filename: MISSION_TASKS_FILENAME,
      path: missionPath,
      content: await missionFile.text(),
    };
  }
  return null;
}

/**
 * Return true when both `tasks.md` and `agent-tasks.md` have zero
 * unchecked items. A missing file counts as complete for that file.
 */
export async function bothFilesCompleted(changeDir: string): Promise<boolean> {
  for (const name of [MISSION_TASKS_FILENAME, AGENT_TASKS_FILENAME]) {
    const f = Bun.file(join(changeDir, name));
    if (!(await f.exists())) continue;
    if (!allCompleted(await f.text())) return false;
  }
  return true;
}
