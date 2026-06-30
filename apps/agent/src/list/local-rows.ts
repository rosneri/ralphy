import { join } from "node:path";
import { getStorage, getLayout } from "@ralphy/context";
import { worktreesDir } from "../agent/worktree";

export interface LocalRow {
  name: string;
  status: string;
  iters: string;
  progress: string;
  prompt: string;
  source: string;
}

export function countTaskItems(content: string): { checked: number; unchecked: number } {
  const checked = (content.match(/^- \[x\]/gm) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, unchecked };
}

export function buildLocalRows(): LocalRow[] {
  const storage = getStorage();
  const layout = getLayout();
  const statesDir = layout.statesDir;
  const projectRoot = layout.root;
  const rows: LocalRow[] = [];
  const seen = new Set<string>();

  const sources: { dir: string; label: string }[] = [{ dir: statesDir, label: "main" }];
  const worktreesRoot = worktreesDir(projectRoot);
  for (const wt of storage.list(worktreesRoot)) {
    sources.push({ dir: join(worktreesRoot, wt, ".ralph", "tasks"), label: `wt:${wt}` });
  }

  for (const { dir, label } of sources) {
    for (const entry of storage.list(dir)) {
      if (seen.has(entry)) continue;
      const raw = storage.read(join(dir, entry, ".ralph-state.json"));
      if (raw === null) continue;
      let state: Record<string, unknown>;
      try {
        state = JSON.parse(raw);
      } catch {
        continue;
      }
      if (String(state.status ?? "") === "completed") continue;

      const promptRaw = String(state.prompt ?? "");
      const firstLine = promptRaw.split("\n").find((l) => l.trim() !== "") ?? "";

      let progress = "—";
      const tasksContent = storage.read(join(dir, entry, "tasks.md"));
      if (tasksContent !== null) {
        const { checked, unchecked } = countTaskItems(tasksContent);
        const total = checked + unchecked;
        if (total > 0) progress = `${checked}/${total}`;
      }

      seen.add(entry);
      rows.push({
        name: String(state.name ?? entry),
        status: String(state.status ?? "unknown"),
        iters: String(state.iteration ?? 0),
        progress,
        prompt: firstLine
          .replace(/^#+\s*/, "")
          .trim()
          .slice(0, 60),
        source: label,
      });
    }
  }
  return rows;
}

export function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

export function printLocalRows(rows: LocalRow[]): void {
  if (rows.length === 0) {
    process.stdout.write("\n  No incomplete local tasks.\n");
    return;
  }
  const cols = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    iters: 5,
    progress: 8,
    source: Math.max(6, ...rows.map((r) => r.source.length)),
  };
  process.stdout.write("\nLocal tasks:\n");
  process.stdout.write(
    `${pad("Name", cols.name)}  ${pad("Status", cols.status)}  ${pad("Iters", cols.iters)}  ${pad("Progress", cols.progress)}  ${pad("Source", cols.source)}  Description\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${pad(r.name, cols.name)}  ${pad(r.status, cols.status)}  ${pad(r.iters, cols.iters)}  ${pad(r.progress, cols.progress)}  ${pad(r.source, cols.source)}  ${r.prompt}\n`,
    );
  }
}

export function findPullRequestUrl(
  attachments: { url: string; sourceType: string | null }[],
): string | null {
  for (const a of attachments) {
    if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(a.url)) return a.url;
  }
  return null;
}
