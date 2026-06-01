import { dispositionFromExitCode } from "./disposition";
import type { RetroContext } from "./types";

/**
 * Build the one-shot retrospective prompt. It embeds the ticket digest, every
 * data-source path, the PR URL (or a "no PR" note), the required report
 * structure, the instruction to Write the report to `outputPath`, and an
 * explicit rule that the agent must perform NO git/PR side effects.
 */
export function buildRetroPrompt(ctx: RetroContext, outputPath: string): string {
  const disposition = dispositionFromExitCode(ctx.exitCode);
  const { paths } = ctx;

  const line = (label: string, value: string | null): string =>
    value ? `- ${label}: ${value}` : `- ${label}: (unavailable — note this in the report)`;

  return [
    `You are a retrospective analysis agent reviewing a finished automated ticket run.`,
    `Your job is to read the run's artifacts and write a thorough, honest self-review`,
    `to a markdown file. You are NOT fixing anything — this is analysis only.`,
    ``,
    `## Ticket`,
    ``,
    `- Identifier: ${ctx.identifier}`,
    `- Change name: ${ctx.changeName}`,
    `- Terminal disposition: ${disposition} (worker exit code ${ctx.exitCode})`,
    ctx.prUrl ? `- Pull request: ${ctx.prUrl}` : `- Pull request: none was opened`,
    `- Date: ${ctx.date}`,
    ``,
    `### Ticket details`,
    ``,
    ctx.ticketDigest,
    ``,
    `## Data sources`,
    ``,
    `Read whatever of the following exist. If a path is missing or empty, say so`,
    `explicitly in the report rather than guessing.`,
    ``,
    line("Change directory (proposal/design/tasks/specs)", paths.changeDir),
    line("Loop state file", paths.stateFilePath),
    line("Worker log", paths.logFile),
    line("JSON event log", paths.jsonLogFile),
    line("Agent run state", paths.agentStateFile),
    ctx.prUrl
      ? `- You may inspect the PR read-only with \`gh pr view ${ctx.prUrl}\` and \`gh pr diff ${ctx.prUrl}\`.`
      : `- No PR exists; skip the PR section and note "no PR".`,
    ``,
    `## Required report structure`,
    ``,
    `Write GitHub-flavored markdown with these sections:`,
    `1. **Summary** — what the ticket asked for and how the run ended.`,
    `2. **What went well** — concrete things the run did right.`,
    `3. **What went wrong / friction** — failures, retries, wasted iterations,`,
    `   wrong turns, anything that cost time or quality.`,
    `4. **Root-cause analysis** — for each problem, why it happened.`,
    `5. **Recommendations** — specific, actionable improvements (to the prompt,`,
    `   the tasks, the codebase, or the workflow).`,
    `6. **Data gaps** — which data sources were unavailable or unread.`,
    ``,
    `## Output`,
    ``,
    `Write the complete report to this exact path using your file-write tool:`,
    ``,
    `    ${outputPath}`,
    ``,
    `## Hard rules`,
    ``,
    `- Do NOT run any git mutation: no commit, add, push, rebase, reset, checkout,`,
    `  branch, merge, tag, or stash.`,
    `- Do NOT create, edit, comment on, close, or merge any pull request or issue.`,
    `- Do NOT modify any source file. The ONLY file you may write is the report at`,
    `  the path above.`,
    `- Read-only inspection commands (\`git log\`, \`git diff\`, \`gh pr view\`,`,
    `  \`gh pr diff\`, reading files) are allowed.`,
  ].join("\n");
}
