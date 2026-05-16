/**
 * Mirror `openspec/changes/<change>/tasks.md` into the linked Linear issue
 * description as a Markdown checklist. Updates between sentinel HTML
 * comment markers so manual edits outside the block are preserved.
 */

export const RALPHY_TASKS_START = "<!-- ralphy:tasks:start -->";
export const RALPHY_TASKS_END = "<!-- ralphy:tasks:end -->";

const MAX_BLOCK_BYTES = 60 * 1024;
const MAX_CODE_BLOCK_BYTES = 2 * 1024;

interface RenderMeta {
  changeName: string;
  iteration: number;
}

interface ParsedItem {
  /** Raw line including `- [ ]` / `- [x]` prefix. */
  bullet: string;
  /** Optional fenced code block following this bullet (without the fences). */
  code?: string;
}

interface ParsedSection {
  heading: string;
  items: ParsedItem[];
}

function parseTasksMd(md: string): ParsedSection[] {
  const lines = md.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      current = { heading: headingMatch[1]!, items: [] };
      sections.push(current);
      i += 1;
      continue;
    }
    const bulletMatch = /^(\s*)-\s+\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (bulletMatch && current) {
      const indent = bulletMatch[1] ?? "";
      const checked = bulletMatch[2]?.toLowerCase() === "x";
      const text = bulletMatch[3] ?? "";
      const bullet = `${indent}- [${checked ? "x" : " "}] ${text}`;
      i += 1;
      // Skip blank lines, then look for a fenced code block belonging to this bullet.
      let j = i;
      while (j < lines.length && lines[j]!.trim() === "") j += 1;
      let code: string | undefined;
      if (j < lines.length && /^\s*```/.test(lines[j]!)) {
        const fenceOpen = lines[j]!;
        const fenceMatch = /^(\s*)```/.exec(fenceOpen);
        const fenceIndent = fenceMatch?.[1] ?? "";
        const buf: string[] = [];
        j += 1;
        while (j < lines.length) {
          if (new RegExp(`^${fenceIndent}\`\`\`\\s*$`).test(lines[j]!)) {
            j += 1;
            break;
          }
          buf.push(lines[j]!);
          j += 1;
        }
        code = buf.join("\n");
        i = j;
      }
      current.items.push(code !== undefined ? { bullet, code } : { bullet });
      continue;
    }
    i += 1;
  }
  return sections;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated)`;
}

export function renderTasksBlock(tasksMd: string, meta: RenderMeta): string {
  const sections = parseTasksMd(tasksMd);
  const out: string[] = [];
  out.push(RALPHY_TASKS_START);
  out.push("### Ralph progress");
  out.push("");
  for (const section of sections) {
    if (section.items.length === 0) continue;
    out.push(`**${section.heading}**`);
    out.push("");
    for (const item of section.items) {
      out.push(item.bullet);
      if (item.code !== undefined) {
        const inner = truncate(item.code, MAX_CODE_BLOCK_BYTES);
        out.push(`  <details><summary>output</summary><pre>${inner}</pre></details>`);
      }
    }
    out.push("");
  }
  out.push(`<sub>\`${meta.changeName}\` · iteration ${meta.iteration}</sub>`);
  out.push(RALPHY_TASKS_END);
  return out.join("\n");
}

export function applyTasksBlock(existingDescription: string | null, block: string): string {
  const existing = existingDescription ?? "";
  const startIdx = existing.indexOf(RALPHY_TASKS_START);
  const endIdx =
    startIdx >= 0 ? existing.indexOf(RALPHY_TASKS_END, startIdx + RALPHY_TASKS_START.length) : -1;
  if (startIdx >= 0 && endIdx >= 0) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + RALPHY_TASKS_END.length);
    return `${before}${block}${after}`;
  }
  // Append (markers absent or only one present).
  if (existing.length === 0) return block;
  const trimmed = existing.replace(/\s+$/, "");
  return `${trimmed}\n\n${block}`;
}

export interface SyncTasksDeps {
  apiKey: string;
  issueId: string;
  currentDescription: string | null;
  tasksPath: string;
  changeName: string;
  iteration: number;
  log: (text: string, color?: string) => void;
  updateIssueDescription: (apiKey: string, issueId: string, description: string) => Promise<void>;
}

/** Orchestrator. Returns the new description if a write occurred, else null. */
export async function syncTasksToLinearDescription(deps: SyncTasksDeps): Promise<string | null> {
  const file = Bun.file(deps.tasksPath);
  if (!(await file.exists())) {
    deps.log(`  sync-tasks: tasks.md missing at ${deps.tasksPath}, skipping`, "gray");
    return null;
  }
  let tasksMd: string;
  try {
    tasksMd = await file.text();
  } catch (err) {
    deps.log(
      `! sync-tasks: read failed for ${deps.tasksPath}: ${(err as Error).message}`,
      "yellow",
    );
    return null;
  }
  const block = renderTasksBlock(tasksMd, {
    changeName: deps.changeName,
    iteration: deps.iteration,
  });
  if (block.length > MAX_BLOCK_BYTES) {
    deps.log(
      `! sync-tasks: rendered block exceeds ${MAX_BLOCK_BYTES} bytes (${block.length}), skipping update`,
      "yellow",
    );
    return null;
  }
  const next = applyTasksBlock(deps.currentDescription, block);
  if (next === (deps.currentDescription ?? "")) return null;
  try {
    await deps.updateIssueDescription(deps.apiKey, deps.issueId, next);
    deps.log(`  sync-tasks: updated Linear description for ${deps.changeName}`, "gray");
    return next;
  } catch (err) {
    deps.log(`! sync-tasks: updateIssueDescription failed: ${(err as Error).message}`, "yellow");
    return null;
  }
}
