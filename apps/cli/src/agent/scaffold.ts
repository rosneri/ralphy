import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { LinearComment, LinearIssue } from "./linear";

/** Convert a Linear identifier (e.g. "ENG-123") into a safe change-name slug. */
export function changeNameForIssue(issue: LinearIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${issue.identifier.toLowerCase()}-${slug}` : issue.identifier.toLowerCase();
}

export async function scaffoldChangeForIssue(
  tasksDir: string,
  statesDir: string,
  issue: LinearIssue,
  comments: LinearComment[] = [],
): Promise<string> {
  const name = changeNameForIssue(issue);
  const changeDir = join(tasksDir, name);
  const stateDir = join(statesDir, name);
  await mkdir(changeDir, { recursive: true });
  await mkdir(join(changeDir, "specs"), { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const commentsBlock =
    comments.length > 0
      ? [
          "",
          "## Linear comments",
          "",
          ...comments.flatMap((c) => [
            `**${c.user?.name ?? "unknown"}** — ${c.createdAt}`,
            "",
            c.body.trim(),
            "",
          ]),
        ]
      : [];

  const proposal = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `Source: [${issue.identifier}](${issue.url})`,
    `Status: ${issue.state.name}`,
    issue.assignee ? `Assignee: ${issue.assignee.name}` : "",
    issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
    "",
    "## Description",
    "",
    issue.description?.trim() || "_No description provided in Linear._",
    ...commentsBlock,
    "",
    "## Steering",
    "",
    "_Add steering notes here as the loop runs._",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const tasks = [
    `# Tasks for ${issue.identifier}`,
    "",
    `- [ ] Read the Linear issue at ${issue.url} and break it into concrete subtasks`,
    `- [ ] Implement the changes described in proposal.md`,
    `- [ ] Add or update tests covering the new behavior`,
    `- [ ] Run \`bun run lint\` and \`bun run test\` and fix any failures`,
    "",
  ].join("\n");

  const design = [
    `# Design for ${issue.identifier}`,
    "",
    "_Fill in the technical design as you work through the issue._",
    "",
  ].join("\n");

  await Bun.write(join(changeDir, "proposal.md"), proposal);
  await Bun.write(join(changeDir, "tasks.md"), tasks);
  await Bun.write(join(changeDir, "design.md"), design);

  return name;
}
