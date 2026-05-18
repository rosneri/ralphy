/**
 * Renders `openspec/changes/<change>/tasks.md` into a Markdown block.
 * Used by the sticky-comment sync in `comment-sync.ts`.
 */

export const RALPHY_TASKS_START = "<!-- ralphy:tasks:start -->";
export const RALPHY_TASKS_END = "<!-- ralphy:tasks:end -->";

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
  const sections = parseTasksMd(tasksMd).filter(
    (s) => s.heading.trim().toLowerCase() !== "planning",
  );
  const out: string[] = [];
  out.push(RALPHY_TASKS_START);
  out.push("### Ralph progress");
  out.push("");
  const renderable = sections.filter((s) => s.items.length > 0);
  if (renderable.length === 0) {
    out.push("_No mission tasks yet — planning in progress._");
    out.push("");
  } else {
    for (const section of renderable) {
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
  }
  out.push(`<sub>\`${meta.changeName}\` · iteration ${meta.iteration}</sub>`);
  out.push(RALPHY_TASKS_END);
  return out.join("\n");
}
