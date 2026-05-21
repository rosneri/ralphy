import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";
import { loadWorkflow, renderWorkflowPrompt } from "@ralphy/workflow";
import { fsChange } from "../../shared/capabilities/fs-change";
import { git } from "../../shared/capabilities/git";
import { runCapability } from "../../shared/capabilities/run-capability";
import type { ParsedArgs } from "../../cli";
import type { RalphyConfig } from "../config";
import { baseBranchFromLabels, fetchIssueComments, type LinearIssue } from "../linear";
import { changeNameForIssue, scaffoldChangeForIssue } from "../scaffold";
import { worktreeDirNameForIssue, type GitRunner } from "../worktree";
import type { PrepareResult, QueueTrigger, MentionTrigger } from "../coordinator";
import { buildReviewTaskBody, buildMentionTaskBody, isRalphComment } from "./task-bodies";

interface WireMaps {
  cwdByChange: Map<string, string>;
  statesDirByChange: Map<string, string>;
  issueByChange: Map<string, LinearIssue>;
  branchByChange: Map<string, string>;
  prByChange: Map<string, string>;
}

interface PrepareInput {
  args: ParsedArgs;
  cfg: RalphyConfig;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  apiKey: string;
  useWorktree: boolean;
  gitRunner: GitRunner;
  diag: (area: string, message: string, color?: string) => void;
  maps: WireMaps;
  scriptRunner: (cmd: string, cwd: string) => Promise<number>;
}

interface PrepareHelpers {
  prepare: (issue: LinearIssue) => Promise<PrepareResult>;
  prepareTaskForTrigger: (
    issue: LinearIssue,
    changeName: string,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ) => Promise<void>;
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  reactivateState: (stateFilePath: string, changeName: string) => Promise<void>;
}

export function createPrepareHelpers(input: PrepareInput): PrepareHelpers {
  const {
    args,
    cfg,
    projectRoot,
    statesDir,
    tasksDir,
    apiKey,
    useWorktree,
    gitRunner,
    diag,
    maps,
    scriptRunner,
  } = input;

  async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
    diag("script", `  ${label}: ${cmd}`, "gray");
    const code = await scriptRunner(cmd, cwd);
    if (code !== 0) {
      diag("script", `! ${label} exited code ${code}`, "yellow");
    }
  }

  async function setupWorktree(issue: LinearIssue): Promise<{
    workerCwd: string;
    scaffoldTasksDir: string;
    scaffoldStatesDir: string;
    branch: string | null;
  }> {
    let workerCwd = projectRoot;
    let scaffoldTasksDir = tasksDir;
    let scaffoldStatesDir = statesDir;
    let branch: string | null = null;
    if (!useWorktree) return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
    const probeName = worktreeDirNameForIssue(issue);
    const baseBranch = baseBranchFromLabels(issue.labels) ?? cfg.prBaseBranch;
    let wt: { cwd: string; branch: string };
    try {
      wt = await runCapability(git.createWorktree, {
        projectRoot,
        changeName: probeName,
        baseBranch,
        runner: gitRunner,
      });
    } catch (err) {
      diag(
        "worktree",
        `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — skipping (useWorktree is required)`,
        "red",
      );
      throw err;
    }
    workerCwd = wt.cwd;
    branch = wt.branch;
    const wtLayout = projectLayout(wt.cwd);
    scaffoldTasksDir = wtLayout.tasksDir;
    scaffoldStatesDir = wtLayout.statesDir;
    diag("worktree", `  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
    try {
      await runCapability(git.seedWorktreeMcpConfig, {
        projectRoot,
        worktreeCwd: wt.cwd,
      });
    } catch (err) {
      diag(
        "worktree",
        `! seeding .mcp.json failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
    return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
  }

  async function prepare(issue: LinearIssue): Promise<PrepareResult> {
    const { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch } = await setupWorktree(issue);

    let changeName: string;
    const wtLayoutPre = projectLayout(workerCwd);
    const derivedName = changeNameForIssue(issue);
    const tasksMdPath = join(wtLayoutPre.changeDir(derivedName), "tasks.md");
    const tasksMdExists = await Bun.file(tasksMdPath).exists();
    const isFresh = !tasksMdExists;
    if (isFresh) {
      let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
      try {
        comments = await fetchIssueComments(apiKey, issue.id);
      } catch (err) {
        diag(
          "linear",
          `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
      let workflowPrompt = "";
      try {
        const workflow = await loadWorkflow(projectRoot);
        workflowPrompt = renderWorkflowPrompt(workflow, {
          issue: {
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? "",
            url: issue.url,
            labels: issue.labels,
          },
          attempt: 1,
          last_error: "",
        }).trim();
      } catch (err) {
        diag("workflow", `! workflow render failed: ${(err as Error).message}`, "yellow");
      }
      const appendPrompt = [args.prompt || cfg.appendPrompt || "", workflowPrompt]
        .filter(Boolean)
        .join("\n\n");
      changeName = await scaffoldChangeForIssue(
        scaffoldTasksDir,
        scaffoldStatesDir,
        issue,
        comments,
        appendPrompt,
      );
    } else {
      changeName = derivedName;
      await mkdir(wtLayoutPre.changeDir(changeName), { recursive: true });
      await mkdir(wtLayoutPre.taskStateDir(changeName), { recursive: true });
    }

    maps.cwdByChange.set(changeName, workerCwd);
    maps.statesDirByChange.set(changeName, scaffoldStatesDir);
    maps.issueByChange.set(changeName, issue);
    if (branch) maps.branchByChange.set(changeName, branch);

    if (cfg.setupScript) {
      await runScript("setup", cfg.setupScript, workerCwd);
    }

    return {
      changeName,
      ...(maps.prByChange.has(changeName) ? { prUrl: maps.prByChange.get(changeName)! } : {}),
    };
  }

  async function reactivateState(stateFilePath: string, changeName: string): Promise<void> {
    const file = Bun.file(stateFilePath);
    if (!(await file.exists())) return;
    try {
      const stateObj = JSON.parse(await file.text()) as {
        status?: string;
        lastModified?: string;
      };
      if (stateObj.status !== "active") {
        stateObj.status = "active";
        stateObj.lastModified = new Date().toISOString();
        await Bun.write(stateFilePath, JSON.stringify(stateObj, null, 2) + "\n");
      }
    } catch (err) {
      diag(
        "state",
        `! could not reactivate state for ${changeName}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  async function prepareTaskForTrigger(
    issue: LinearIssue,
    changeName: string,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ): Promise<void> {
    if (trigger !== "review" && trigger !== "conflict-fix") return;
    const workerCwd = maps.cwdByChange.get(changeName);
    if (!workerCwd) return;
    const wtLayout = projectLayout(workerCwd);
    const tasksFile = join(wtLayout.changeDir(changeName), AGENT_TASKS_FILENAME);
    if (trigger === "review") {
      let body: string;
      let heading: string;
      if (mention) {
        heading =
          mention.source === "github"
            ? "Address GitHub @ralphy mention"
            : "Address Linear @ralphy mention";
        body = buildMentionTaskBody(mention, issue.url);
      } else {
        heading = "Address reviewer comments";
        let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
        try {
          comments = await fetchIssueComments(apiKey, issue.id);
        } catch (err) {
          diag(
            "linear",
            `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
        const reviewerComments = comments.filter((c) => !isRalphComment(c.body));
        body = buildReviewTaskBody(reviewerComments, issue.url);
      }
      try {
        await runCapability(fsChange.prependTask, {
          tasksPath: tasksFile,
          heading,
          failureOutput: body,
        });
      } catch (err) {
        diag("tasks", `! could not prepend review task: ${(err as Error).message}`, "red");
      }
      await reactivateState(wtLayout.stateFile(changeName), changeName);
      return;
    }
    // conflict-fix
    const prUrl = maps.prByChange.get(changeName);
    const body = [
      `The PR for this change has merge conflicts with \`${cfg.prBaseBranch}\`.`,
      "",
      "Steps:",
      `1. \`git fetch origin ${cfg.prBaseBranch}\` then rebase or merge \`${cfg.prBaseBranch}\` into the current branch.`,
      "2. Resolve conflicts in the files git lists.",
      "3. Stage and commit the resolution.",
      prUrl ? `\nPR: ${prUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await runCapability(fsChange.prependTask, {
        tasksPath: tasksFile,
        heading: "Resolve PR merge conflicts",
        failureOutput: body,
      });
    } catch (err) {
      diag("tasks", `! could not prepend conflict-fix task: ${(err as Error).message}`, "red");
    }
    await reactivateState(wtLayout.stateFile(changeName), changeName);
  }

  return { prepare, prepareTaskForTrigger, runScript, reactivateState };
}
