import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { projectLayout } from "@ralphy/core/layout";
import { AGENT_TASKS_FILENAME } from "@ralphy/core/tasks-md";
import { loadWorkflow, renderWorkflowPrompt } from "@ralphy/workflow";
import { fsChange } from "../../shared/capabilities/fs-change";
import { git } from "../../shared/capabilities/git";
import { runCapability } from "../../shared/capabilities/run-capability";
import type { AgentParsedArgs } from "../../cli";
import type { RalphyConfig } from "../config";
import {
  baseBranchFromLabels,
  fetchIssueAttachments,
  fetchIssueComments,
} from "../../shared/capabilities/linear-client";
import type { TrackedIssue } from "@ralphy/tracker";
import { changeNameForIssue, scaffoldChangeForIssue } from "../scaffold";
import {
  worktreeDirNameForIssue,
  type GitRunner,
  type WorktreeHandle,
  type WorktreeProvider,
} from "../worktree";
import type { PrepareResult, QueueTrigger, MentionTrigger } from "../coordinator";
import { buildReviewTaskBody, buildMentionTaskBody, isRalphComment } from "./task-bodies";

/**
 * Compose the append-prompt handed to the scaffold step from the CLI `--prompt`
 * override (or the config fallback) and the rendered workflow prompt. Pure and
 * exported so the precedence + empty-segment dropping is unit-testable in
 * isolation, mirroring the extracted-helper pattern from `worker-decisions.ts`
 * (RLF-211). The CLI prompt wins over the config fallback; empty segments are
 * dropped so a blank workflow render never leaves a trailing separator.
 */
export function composeAppendPrompt(
  promptArg: string,
  cfgAppendPrompt: string,
  workflowPrompt: string,
): string {
  return [promptArg || cfgAppendPrompt || "", workflowPrompt].filter(Boolean).join("\n\n");
}

interface WireMaps {
  cwdByChange: Map<string, string>;
  statesDirByChange: Map<string, string>;
  issueByChange: Map<string, TrackedIssue>;
  branchByChange: Map<string, string>;
  prByChange: Map<string, string>;
}

interface PrepareInput {
  args: AgentParsedArgs;
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
  /** Override worktree provisioning (create + seed). Defaults to the real git
   *  capability. Injected by tests so a full-wire `createPr` run resolves a
   *  branch + cwd without touching `~/.ralph`. */
  worktreeProvider?: WorktreeProvider;
}

/** Production worktree provider: the real `createWorktree` / `seedWorktreeMcpConfig`
 *  capabilities. Touches `~/.ralph/...` and the filesystem. */
const defaultWorktreeProvider: WorktreeProvider = {
  create: (args) => runCapability(git.createWorktree, args),
  seedMcpConfig: (args) => runCapability(git.seedWorktreeMcpConfig, args),
};

interface PrepareHelpers {
  prepare: (issue: TrackedIssue) => Promise<PrepareResult>;
  prepareTaskForTrigger: (
    issue: TrackedIssue,
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
  const worktreeProvider = input.worktreeProvider ?? defaultWorktreeProvider;

  async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
    diag("script", `  ${label}: ${cmd}`, "gray");
    const code = await scriptRunner(cmd, cwd);
    if (code !== 0) {
      diag("script", `! ${label} exited code ${code}`, "yellow");
    }
  }

  async function setupWorktree(issue: TrackedIssue): Promise<{
    workerCwd: string;
    scaffoldTasksDir: string;
    scaffoldStatesDir: string;
    branch: string | null;
    /** Whether the worktree was newly provisioned this call (true) vs reused
     *  (false), or `null` when not running in worktree mode. */
    worktreeCreated: boolean | null;
  }> {
    let workerCwd = projectRoot;
    let scaffoldTasksDir = tasksDir;
    let scaffoldStatesDir = statesDir;
    let branch: string | null = null;
    if (!useWorktree)
      return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch, worktreeCreated: null };
    const probeName = worktreeDirNameForIssue(issue);
    const baseBranch = baseBranchFromLabels(issue.labels) ?? cfg.prBaseBranch;
    let wt: WorktreeHandle;
    try {
      wt = await worktreeProvider.create({
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
      await worktreeProvider.seedMcpConfig({
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
    return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch, worktreeCreated: wt.created };
  }

  async function prepare(issue: TrackedIssue): Promise<PrepareResult> {
    const { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch, worktreeCreated } =
      await setupWorktree(issue);

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
      let attachments: Awaited<ReturnType<typeof fetchIssueAttachments>> = [];
      try {
        attachments = await fetchIssueAttachments(apiKey, issue.id);
      } catch (err) {
        diag(
          "linear",
          `! Linear attachment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
      let workflowPrompt = "";
      try {
        const workflow = await loadWorkflow(projectRoot, args.workflowFile);
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
      const appendPrompt = composeAppendPrompt(
        args.prompt ?? "",
        cfg.appendPrompt ?? "",
        workflowPrompt,
      );
      changeName = await scaffoldChangeForIssue(
        scaffoldTasksDir,
        scaffoldStatesDir,
        issue,
        comments,
        appendPrompt,
        attachments,
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

    // Run the setup script only on first provisioning of the worktree, not on
    // every resume/conflict-fix/ci-fix/review re-prepare. `worktreeCreated`
    // is the authoritative signal in worktree mode; in non-worktree mode it is
    // null, so fall back to `isFresh` (first scaffold) to preserve run-once.
    const runSetup = worktreeCreated ?? isFresh;
    if (cfg.setupScript && runSetup) {
      await runScript("setup", cfg.setupScript, workerCwd);
    }

    return {
      changeName,
      // Carried onto the ActiveWorker so post-exit syncTasks flushes can
      // still resolve the worktree after releaseWorkerMaps has run.
      cwd: workerCwd,
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
    issue: TrackedIssue,
    changeName: string,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ): Promise<void> {
    if (trigger !== "review" && trigger !== "conflict-fix" && trigger !== "ci-fix") return;
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
    const branch = maps.branchByChange.get(changeName);
    const branchRef = branch ?? "<current-branch>";
    const body = [
      `The PR for this change has merge conflicts with \`${cfg.prBaseBranch}\`.`,
      "",
      "Steps:",
      `1. \`git fetch origin ${cfg.prBaseBranch}\` then merge \`${cfg.prBaseBranch}\` into the current branch (\`git merge origin/${cfg.prBaseBranch}\`). Do NOT rebase.`,
      "2. Resolve conflicts in the files git lists.",
      "3. Stage and commit the resolution as a new merge commit. Do NOT amend existing commits.",
      `4. Push the resolved branch with \`git push origin ${branchRef}\`. Never force-push.`,
      `   The post-task harness will NOT push for you in conflict-fix mode — you own the push.`,
      `   If the push is rejected, inspect the rejection output and react inline before retrying:`,
      `     - **non-fast-forward** (someone else pushed to \`${branchRef}\`):`,
      `       \`git fetch origin ${branchRef}\` then \`git merge origin/${branchRef}\` to bring their`,
      `       changes in as a new merge commit, re-resolve any new conflicts, and retry the push.`,
      `       Do NOT rebase and do NOT \`--force\` / \`--force-with-lease\` — work on the remote must`,
      `       never be overwritten.`,
      `     - **pre-push hook failure** (lint, typecheck, tests): fix the underlying problem locally,`,
      `       \`git add\` + \`git commit\` as a new commit (NEVER \`--amend\` an existing commit),`,
      `       then retry the push.`,
      `     - **ref-update policy rejection** (branch protection, required reviews): log the rejection`,
      `       message and stop — this requires human intervention; do not force past it.`,
      `   Only stop after exhausting the in-context fix. The push must succeed before this iteration ends.`,
      prUrl ? `\nPR: ${prUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (trigger === "conflict-fix") {
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
      return;
    }

    // ci-fix
    const ciPrUrl = maps.prByChange.get(changeName);
    const ciBranch = maps.branchByChange.get(changeName);
    const ciBranchRef = ciBranch ?? "<current-branch>";
    const ciBody = [
      `The PR for this change has failing CI checks.`,
      "",
      "Steps:",
      `1. Inspect the failing checks: \`gh pr checks ${ciPrUrl ?? "<pr-url>"}\` then`,
      `   \`gh run view <run-id> --log-failed\` for each red run.`,
      `2. Fix the underlying failures in the worktree (tests, lint, typecheck, build).`,
      `3. Stage and commit the fixes.`,
      `4. Push with \`git push origin ${ciBranchRef}\`. If the push is rejected as`,
      `   non-fast-forward, \`git fetch origin ${ciBranchRef}\` then \`git merge origin/${ciBranchRef}\``,
      `   before retrying. Do NOT rebase, do NOT amend, and never force-push.`,
      `5. Wait for CI to re-run; if checks are still red, repeat from step 1.`,
      `   Stop only when CI is green or when the failure is clearly outside the change's scope`,
      `   (flaky infra, external service down) — in that case, log the rejection and exit.`,
      ciPrUrl ? `\nPR: ${ciPrUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await runCapability(fsChange.prependTask, {
        tasksPath: tasksFile,
        heading: "Fix failing CI checks",
        failureOutput: ciBody,
      });
    } catch (err) {
      diag("tasks", `! could not prepend ci-fix task: ${(err as Error).message}`, "red");
    }
    await reactivateState(wtLayout.stateFile(changeName), changeName);
  }

  return { prepare, prepareTaskForTrigger, runScript, reactivateState };
}
