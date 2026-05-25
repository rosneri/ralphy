import { join } from "node:path";
import { fsChange } from "../shared/capabilities/fs-change";
import { runCapability } from "../shared/capabilities/run-capability";
import type { LinearComment, LinearIssue } from "./linear";

/** Convert a Linear identifier (e.g. "ENG-123") into a safe change-name slug.
 *  The trailing-dash trim runs *after* the 40-char slice so that titles whose
 *  slice boundary lands on a separator don't re-introduce the trailing `-`. */
export function changeNameForIssue(issue: LinearIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return slug ? `${issue.identifier.toLowerCase()}-${slug}` : issue.identifier.toLowerCase();
}

export async function scaffoldChangeForIssue(
  tasksDir: string,
  statesDir: string,
  issue: LinearIssue,
  comments: LinearComment[] = [],
  appendPrompt: string = "",
): Promise<string> {
  const name = changeNameForIssue(issue);
  const changeDir = join(tasksDir, name);
  const stateDir = join(statesDir, name);

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

  const descriptionBody = issue.description?.trim() || "_No description provided in Linear._";
  const proposal = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `Source: [${issue.identifier}](${issue.url})`,
    `Status: ${issue.state.name}`,
    issue.assignee ? `Assignee: ${issue.assignee.name}` : "",
    issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
    "",
    "## Why",
    "",
    descriptionBody,
    "",
    "## What Changes",
    "",
    "_Describe the concrete changes this proposal introduces (one bullet per change)._",
    ...commentsBlock,
    ...(appendPrompt.trim() ? ["", "## Additional instructions", "", appendPrompt.trim()] : []),
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
    "## Planning",
    "",
    `- [ ] Read the Linear issue at ${issue.url} and research the codebase to understand the mission and its scope`,
    `- [ ] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research`,
    `- [ ] Fill in \`## Why\` and \`## What Changes\` in proposal.md so \`openspec validate\` passes (these sections are required by the validator)`,
    `- [ ] Add at least one spec delta under \`specs/<capability>/spec.md\` describing the behavior added/modified/removed by this change`,
    `- [ ] Fill in design.md with the technical design (files to touch, data flow, edge cases)`,
    `- [ ] Append an \`## Implementation\` section below with concrete mission-specific tasks derived from the plan, including tests and \`bun run lint\` / \`bun run test\`. Every item in the new section MUST start as \`- [ ]\` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.`,
    `- [ ] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.`,
    "",
  ].join("\n");

  const design = [
    `# Design for ${issue.identifier}`,
    "",
    "_Fill in the technical design as you work through the issue._",
    "",
  ].join("\n");

  await runCapability(fsChange.scaffold, {
    changeDir,
    stateDir,
    proposal,
    tasks,
    design,
  });

  return name;
}
