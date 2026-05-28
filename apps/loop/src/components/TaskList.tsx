import { useEffect } from "react";
import { join } from "node:path";
import { Box, Text, useApp } from "ink";
import { getStorage, getLayout } from "@ralphy/context";
import { worktreesDir } from "@ralphy/paths";

/**
 * Count checked and unchecked task items in a markdown file.
 */
function countLoopTaskItems(content: string): { checked: number; unchecked: number } {
  const checked = (content.match(/^- \[x\]/gm) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, unchecked };
}

interface TaskListProps {}

interface TaskRow {
  name: string;
  phase: string;
  status: string;
  iters: string;
  progress: string;
  progressStyled: boolean;
  prompt: string;
  source: string;
}

function buildRows(): TaskRow[] {
  const storage = getStorage();
  const layout = getLayout();
  const statesDir = layout.statesDir;
  const projectRoot = layout.root;
  const rows: TaskRow[] = [];
  const seenNames = new Set<string>();

  // Sources: main statesDir + per-worktree .ralph/tasks (when --worktree
  // was used in agent mode, per-task state lives inside the worktree).
  const sources: { dir: string; label: string }[] = [{ dir: statesDir, label: "main" }];
  const worktreesRoot = worktreesDir(projectRoot);
  for (const wt of storage.list(worktreesRoot)) {
    sources.push({
      dir: join(worktreesRoot, wt, ".ralph", "tasks"),
      label: `wt:${wt}`,
    });
  }

  for (const { dir, label } of sources) {
    for (const entry of storage.list(dir)) {
      if (seenNames.has(entry)) continue;
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
      let progressStyled = true;
      const tasksContent = storage.read(join(dir, entry, "tasks.md"));
      if (tasksContent !== null) {
        const { checked, unchecked } = countLoopTaskItems(tasksContent);
        const total = checked + unchecked;
        if (total > 0) {
          progress = `${checked}/${total}`;
          progressStyled = false;
        }
      }

      seenNames.add(entry);
      rows.push({
        name: String(state.name ?? entry),
        phase: String(state.status ?? "active"),
        status: String(state.status ?? "unknown"),
        iters: String(state.iteration ?? 0),
        progress,
        progressStyled,
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

export function TaskList({}: TaskListProps) {
  const { exit } = useApp();

  useEffect(() => {
    exit();
  }, [exit]);

  const rows = buildRows();

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text dimColor> No incomplete tasks.</Text>
        <Text> </Text>
      </Box>
    );
  }

  const cols = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    phase: Math.max(5, ...rows.map((r) => r.phase.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    iters: 5,
    progress: 8,
    source: Math.max(6, ...rows.map((r) => r.source.length)),
  };

  const ruleWidth =
    cols.name + cols.phase + cols.status + cols.iters + cols.progress + cols.source + 60 + 12;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text bold>{"Name".padEnd(cols.name)}</Text>
        {"  "}
        <Text bold>{"Phase".padEnd(cols.phase)}</Text>
        {"  "}
        <Text bold>{"Status".padEnd(cols.status)}</Text>
        {"  "}
        <Text bold>{"Iters".padEnd(cols.iters)}</Text>
        {"  "}
        <Text bold>{"Progress".padEnd(cols.progress)}</Text>
        {"  "}
        <Text bold>{"Source".padEnd(cols.source)}</Text>
        {"  "}
        <Text bold>Description</Text>
      </Text>
      <Text dimColor>{"─".repeat(ruleWidth)}</Text>
      {rows.map((row) => (
        <Text key={row.name}>
          <Text color="cyan">{row.name.padEnd(cols.name)}</Text>
          {"  "}
          {row.phase.padEnd(cols.phase)}
          {"  "}
          {row.status.padEnd(cols.status)}
          {"  "}
          {row.iters.padStart(cols.iters)}
          {"  "}
          {row.progressStyled ? (
            <Text dimColor>{row.progress.padStart(cols.progress)}</Text>
          ) : (
            row.progress.padStart(cols.progress)
          )}
          {"  "}
          <Text dimColor>{row.source.padEnd(cols.source)}</Text>
          {"  "}
          <Text dimColor>{row.prompt}</Text>
        </Text>
      ))}
      <Text> </Text>
    </Box>
  );
}
