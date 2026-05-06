/**
 * Operations on a `tasks.md` file. The format is loose Markdown:
 *
 *   ## Section heading
 *
 *   - [ ] Unchecked task
 *   - [x] Completed task
 *
 * The loop's worker reads the *first* `## ` section that has unchecked
 * items and works on it until the items are ticked off. Anything that
 * mutates `tasks.md` from outside the worker (the agent's hook-fix and
 * CI-fix retry paths) must respect that ordering — new fix sections go
 * *above* existing ones, otherwise the loop chews on stale tasks and
 * never sees the fix.
 *
 * This module is the single source of truth for those rules.
 */

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
