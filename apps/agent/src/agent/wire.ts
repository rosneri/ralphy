import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { logOutput, initWorkerLog, logSession } from "@ralphy/log";
import { projectLayout } from "@ralphy/core/layout";
import { prependFixTask } from "@ralphy/core/tasks-md";
import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { ParsedArgs } from "../cli";
import type { RalphyConfig } from "./config";
import {
  fetchOpenIssues,
  addIssueComment,
  fetchIssueComments,
  fetchIssueAttachments,
  upsertRalphyAttachment,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  fetchTeamIdByKey,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  issueMatchesGetIndicator,
  baseBranchFromLabels,
  type LinearIssue,
  type LinearFilterSpec,
} from "./linear";
import {
  AgentCoordinator,
  type SpawnMode,
  type PrepareResult,
  type MentionTrigger,
} from "./coordinator";
import { changeNameForIssue, scaffoldChangeForIssue } from "./scaffold";
import { createWorktree, seedWorktreeMcpConfig, branchForChange, type GitRunner } from "./worktree";
import { type CmdRunner } from "./pr";
import { runPostTask, type PostTaskPhase } from "./post-task";

/** Phases the dashboard surfaces per worker. Superset of PostTaskPhase
 *  plus the worker-subprocess "working" phase. */
type WorkerPhase = PostTaskPhase | "working" | "scaffolding";

const bunGitRunner: GitRunner = {
  run: async (args, cwd) => {
    const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = new Error("git command failed") as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

const bunCmdRunner: CmdRunner = {
  run: async (cmd, cwd) => {
    const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const firstStderrLine = stderr.trim().split("\n")[0] ?? "";
      const summary = firstStderrLine ? `: ${firstStderrLine}` : "";
      const err = new Error(`\`${cmd.join(" ")}\` exited ${code}${summary}`) as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = stderr;
      err.code = code;
      throw err;
    }
    return { stdout, stderr };
  },
};

/**
 * Side-effect runners. Production wires bun-spawned git / generic command
 * processes; tests inject in-memory fakes so an end-to-end integration
 * suite never spawns a real subprocess. Provide whatever you want to
 * stub; anything you omit falls back to the bun-based default.
 */
export interface AgentRunners {
  git?: GitRunner;
  cmd?: CmdRunner;
  /** Spawn the actual `ralph task` worker subprocess. Default: Bun.spawn. */
  spawnWorker?: (cmd: string[], cwd: string) => { exited: Promise<number>; kill: () => void };
  /** Run a shell script (setup/teardown). Returns exit code; never throws. */
  runScript?: (cmd: string, cwd: string) => Promise<number>;
}

/**
 * Wrap a CmdRunner so each call emits start/end events. The dashboard
 * uses these to surface "currently running `gh pr checks`…" so a hung
 * external command is immediately visible (e.g. GitHub 504 hangs).
 */
function traceCmdRunner(
  base: CmdRunner,
  onStart: (cmd: string[]) => void,
  onEnd: (cmd: string[], durationMs: number, ok: boolean) => void,
): CmdRunner {
  return {
    run: async (cmd, cwd) => {
      const t0 = Date.now();
      onStart(cmd);
      try {
        const r = await base.run(cmd, cwd);
        onEnd(cmd, Date.now() - t0, true);
        return r;
      } catch (err) {
        onEnd(cmd, Date.now() - t0, false);
        throw err;
      }
    },
  };
}

interface BuildAgentCoordinatorInput {
  args: ParsedArgs;
  cfg: RalphyConfig;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
  apiKey: string;
  /** Receive log lines for the UI. */
  onLog: (text: string, color?: string) => void;
  /** Called whenever the active-worker set changes (drives re-render). */
  onWorkersChanged: () => void;
  /** Called when a new worker subprocess starts. The UI uses `statesDir`
   *  to poll `<statesDir>/<changeName>/.ralph-state.json` for iter count,
   *  and `changeDir` to read the first unchecked task from tasks.md. */
  onWorkerStarted: (
    changeName: string,
    statesDir: string,
    logFile: string,
    changeDir: string,
  ) => void;
  /** Called after the post-task block resolves; UI drops the worker row. */
  onWorkerExited: (changeName: string) => void;
  /** Phase transition for a worker — dashboard renders alongside iter+elapsed. */
  onWorkerPhase?: (changeName: string, phase: WorkerPhase, detail?: string) => void;
  /** A line of stdout/stderr captured from the worker subprocess. */
  onWorkerOutput?: (changeName: string, line: string) => void;
  /** Live shell-command tracer — fires on every `cmd.run(...)` start/end
   *  inside post-task. The dashboard uses this to show "running `gh pr
   *  checks` (12s)…" so hung externals are obvious. */
  onWorkerCmd?: (
    changeName: string,
    cmd: string[],
    state: "start" | "end",
    durationMs?: number,
    ok?: boolean,
  ) => void;
  /** Called when a PR URL is registered for a worker — dashboard shows it. */
  onWorkerPr?: (changeName: string, prUrl: string) => void;
  /** Optional side-effect overrides (test injection). */
  runners?: AgentRunners;
}

interface BuildAgentCoordinatorResult {
  coord: AgentCoordinator;
  /** One-line description of the active Linear filter, for the status footer. */
  filterDesc: string;
  concurrency: number;
  pollInterval: number;
  getWorkerCwd: (changeName: string) => string | undefined;
}

/**
 * Resolve the effective Indicators map: CLI overrides replace config keys
 * one-by-one. Repeated CLI flags for the same key collapse into a `Marker[]`.
 * CLI is authoritative when present. Strips `undefined`
 * values from the merged record (exactOptionalPropertyTypes).
 */
function mergeIndicators(cfg: Record<string, unknown>, cli: Partial<Indicators>): Indicators {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(cli)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Indicators;
}

/** True when a Linear comment body was authored by Ralph itself. Match by
 *  the distinctive emoji-prefixed lead used in every comment ralph posts;
 *  this avoids needing to know the Linear user identity at filter time. */
function isRalphComment(body: string): boolean {
  const trimmed = body.trimStart();
  return /^(🤖|🔄|✅|✗|⚠|🔁)\s*Ralph\b/.test(trimmed);
}

/** Format reviewer comments as a fix-task body. Each comment becomes a
 *  fenced block with the author + timestamp header so the worker can see
 *  who said what. Empty input falls back to a "no new comments" stub so
 *  the worker still gets a deterministic task entry. */
function buildReviewTaskBody(
  comments: {
    body: string;
    createdAt: string;
    user: { name: string; email: string | null } | null;
  }[],
  url: string,
): string {
  if (comments.length === 0) {
    return `No non-Ralph reviewer comments were found on ${url}. Recheck the issue manually before continuing.`;
  }
  const blocks = comments.map((c) => {
    const author = c.user?.name ?? "unknown";
    return `**${author}** — ${c.createdAt}\n\n${c.body.trim()}`;
  });
  return [
    `Reviewer comments left on the Linear issue (${url}):`,
    "",
    ...blocks,
    "",
    "Address every concrete request above. If a comment is ambiguous, note",
    "your interpretation in proposal.md `## Steering` before acting.",
  ].join("\n");
}

/** Format a single mention as the prepended task body. Includes the
 *  comment author, timestamp, source, and a permalink so the worker can
 *  cross-reference if more context is needed. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionTaskBody(trigger: MentionTrigger, issueUrl: string): string {
  if (trigger.source === "github-review") {
    // Body was pre-built as a digest by fetchCodeReviewThreads — frame it
    // with the resolution workflow so the worker knows the contract.
    return [
      `Open code-review on ${trigger.url ?? issueUrl} has unresolved comments:`,
      "",
      trigger.body.trim(),
      "",
      "For every comment above, decide:",
      "- If you agree, fix the code, commit, and push. The push will surface",
      "  the new commit on the PR; the worker should then resolve the thread",
      "  via `gh api graphql` (`resolveReviewThread`) — see GitHub docs.",
      "- If you disagree, post a polite reply on the thread explaining your",
      "  reasoning via `gh api repos/{owner}/{repo}/pulls/{num}/comments/{id}/replies`,",
      "  and leave the thread unresolved.",
      "",
      "When this round is done the loop exits; the agent will re-poll the",
      "PR on the next cycle and pick up any new reviewer activity until the",
      "PR is approved or merged.",
    ].join("\n");
  }
  const sourceLabel = trigger.source === "github" ? "GitHub PR" : "Linear issue";
  const permalink = trigger.url ?? issueUrl;
  const header = `${trigger.author ?? "unknown"} — ${trigger.createdAt} (${sourceLabel})`;
  return [
    `An @ralphy mention was left on ${sourceLabel} (${permalink}):`,
    "",
    `**${header}**`,
    "",
    trigger.body.trim(),
    "",
    "Treat this comment as the next concrete request. If it's ambiguous,",
    "note your interpretation in proposal.md `## Steering` before acting.",
  ].join("\n");
}

/** Build a flat marker list across many SetIndicators (used for exclusion). */
function unionMarkers(...sets: (SetIndicator | undefined)[]): Marker[] {
  const out: Marker[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    if (!s) continue;
    for (const m of markersOf(s)) {
      const key = `${m.type}:${m.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

/**
 * Build a fully wired `AgentCoordinator`. Owns the per-change book-keeping
 * maps, the workflow-state / label resolver caches, the prepare and
 * spawnWorker callbacks, and the post-task hand-off.
 */
export function buildAgentCoordinator(
  input: BuildAgentCoordinatorInput,
): BuildAgentCoordinatorResult {
  const {
    args,
    cfg,
    projectRoot,
    statesDir,
    tasksDir,
    apiKey,
    onLog,
    onWorkersChanged,
    onWorkerStarted,
    onWorkerExited,
    onWorkerPhase,
    onWorkerOutput,
    onWorkerCmd,
  } = input;

  const logsDir = join(projectRoot, ".ralph", "logs");

  const concurrency = args.concurrency || cfg.concurrency;
  const pollInterval = args.pollInterval || cfg.pollIntervalSeconds;

  const indicators: Indicators = mergeIndicators(
    cfg.linear.indicators as Record<string, unknown>,
    args.indicators,
  );
  const team = args.linearTeam || cfg.linear.team;
  const assignee = args.linearAssignee || cfg.linear.assignee;

  // Markers excluded from `getTodo` so already-handled issues don't get
  // re-picked. `getInProgress` is intentionally NOT excluded here — the
  // coordinator routes resumes through a different bucket and the include
  // filter for `getTodo` doesn't already match in-progress issues.
  const excludeFromTodo = unionMarkers(
    indicators.setDone,
    indicators.setError,
    indicators.setConflicted,
  );
  // Review filter must not catch issues already in flight or quarantined.
  // We intentionally do NOT exclude setDone markers — review is the way
  // to re-pick a done issue.
  const excludeFromReview = unionMarkers(
    indicators.setInProgress,
    indicators.setError,
    indicators.setConflicted,
  );

  const gitRunner: GitRunner = input.runners?.git ?? bunGitRunner;
  const cmdRunner: CmdRunner = input.runners?.cmd ?? bunCmdRunner;

  const stateCache = new Map<string, Map<string, string>>();
  const labelCache = new Map<string, Map<string, string>>();
  const teamIdCache = new Map<string, string>();
  const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

  async function resolveStateId(issue: LinearIssue, name: string): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = stateCache.get(t);
    if (!map) {
      const states = await fetchWorkflowStates(apiKey, t);
      map = new Map(states.map((s) => [s.name.toLowerCase(), s.id]));
      stateCache.set(t, map);
    }
    return map.get(name.toLowerCase()) ?? null;
  }

  async function resolveLabelId(issue: LinearIssue, name: string): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = labelCache.get(t);
    if (!map) {
      const labels = await fetchIssueLabels(apiKey, t);
      map = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
      labelCache.set(t, map);
    }
    const existing = map.get(name.toLowerCase());
    if (existing) return existing;
    // Label doesn't exist — create it as a single flat label with the
    // literal name (including any colon). We used to split `ralph:foo`
    // into a parent `ralph` group + child `foo`, but if `ralph` already
    // existed as a non-group label Linear rejected the child create
    // with "parent label is not a group". Flat creation is simpler and
    // always works; `fetchIssueLabels` still joins `parent.name + ":" +
    // name` so an existing nested `ralph:foo` matches on lookup.
    try {
      let teamId = teamIdCache.get(t);
      if (!teamId) {
        const fetched = await fetchTeamIdByKey(apiKey, t);
        if (!fetched) return null;
        teamId = fetched;
        teamIdCache.set(t, teamId);
      }
      const newId = await createIssueLabel(apiKey, teamId, name);
      if (!newId) return null;
      map.set(name.toLowerCase(), newId);
      onLog(`  created Linear label '${name}' for team ${t}`, "gray");
      return newId;
    } catch (err) {
      // Linear returns errors as a `messages` array on the rejected
      // promise; show them inline so the user can see e.g. "Label name
      // already exists" instead of just "Linear API returned errors".
      const e = err as Error & { messages?: string[] };
      const detail = e.messages?.length ? ` — ${e.messages.join("; ")}` : "";
      onLog(`! Linear label '${name}' creation threw: ${e.message}${detail}`, "yellow");
      // On any failure, drop the label cache for this team so a stale
      // miss doesn't persist; the next attempt re-queries Linear and
      // may now see the label that was concurrently created elsewhere.
      labelCache.delete(t);
      return null;
    }
  }

  async function applyMarker(issue: LinearIssue, m: Marker): Promise<void> {
    if (m.type === "status") {
      const id = await resolveStateId(issue, m.value);
      if (!id) {
        const err = new Error("Linear status not found") as Error & {
          status?: string;
          issue?: string;
        };
        err.status = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await updateIssueState(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} status='${m.value}'`, "gray");
    } else if (m.type === "attachment") {
      await upsertRalphyAttachment(apiKey, issue.id, issue.url, m.value);
      onLog(`  → ${issue.identifier} attachment='${m.value}'`, "gray");
    } else {
      const id = await resolveLabelId(issue, m.value);
      if (!id) {
        const err = new Error("Linear label could not be resolved") as Error & {
          label?: string;
          issue?: string;
        };
        err.label = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await addLabelToIssue(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} +label='${m.value}'`, "gray");
    }
  }

  async function applyIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) await applyMarker(issue, m);
  }

  /** Removes label-typed markers; status removal is a no-op (Linear status
   *  is mutually exclusive — to "remove" a status you set a different one). */
  async function removeIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) {
      if (m.type !== "label") continue;
      const id = await resolveLabelId(issue, m.value);
      if (!id) {
        onLog(`! Linear label '${m.value}' not found for ${issue.identifier}`, "yellow");
        continue;
      }
      await removeLabelFromIssue(apiKey, issue.id, id);
      onLog(`  → ${issue.identifier} -label='${m.value}'`, "gray");
    }
  }

  async function fetchByGet(
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ): Promise<LinearIssue[]> {
    if (!inc) return [];
    // GetIndicator carries its filter list directly.
    const include = !Array.isArray(inc) && "filter" in inc ? inc.filter : [];
    if (include.length === 0) return [];
    const spec: LinearFilterSpec = {
      team,
      assignee,
      include,
      exclude: excl,
    };
    return fetchOpenIssues(apiKey, spec);
  }

  // Per-changeName book-keeping. The coordinator's deps callbacks read and
  // write these in tandem; they live in the factory's closure rather than
  // on the coordinator because the layout shape is wiring-specific.
  const cwdByChange = new Map<string, string>();
  const statesDirByChange = new Map<string, string>();
  const branchByChange = new Map<string, string>();
  const issueByChange = new Map<string, LinearIssue>();
  /** PR URL per change, populated when a PR is created or surfaced. Used
   *  by the conflict-scan step. Volatile — repopulated on next poll if
   *  the worker recreates a PR. */
  const prByChange = new Map<string, string>();
  /** changeNames whose PR discovery recently failed → expires-at ms. Soft
   *  cache (10 minutes) so a transient `gh` failure or a branch-name
   *  mismatch doesn't permanently silence the conflict scan. */
  const prUnavailable = new Map<string, number>();
  const PR_UNAVAILABLE_TTL_MS = 10 * 60 * 1000;
  /** prUrl → last reviewer-ping ms timestamp. Prevents re-pinging within
   *  `codeReviewStaleHours`. Resets on agent restart (best-effort dedup). */
  const stalePingedAt = new Map<string, number>();

  const useWorktree = args.worktree || cfg.useWorktree;

  const scriptRunner =
    input.runners?.runScript ??
    (async (cmd: string, cwd: string): Promise<number> => {
      const proc = Bun.spawn({
        cmd: ["sh", "-c", cmd],
        cwd,
        env: { ...process.env, WORKSPACE_ROOT: projectRoot },
        stdout: "ignore",
        stderr: "pipe",
        stdin: "ignore",
      });
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        onLog(
          `! script exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
          "yellow",
        );
      }
      return code;
    });

  async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
    onLog(`  ${label}: ${cmd}`, "gray");
    const code = await scriptRunner(cmd, cwd);
    if (code !== 0) {
      onLog(`! ${label} exited code ${code}`, "yellow");
    }
  }

  /** Establish a worktree (or stay in projectRoot when not configured) and
   *  return the working directory + scaffold dirs + branch. Idempotent —
   *  reuses an existing worktree when one is already present. */
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
    const probeName = issue.identifier.toLowerCase();
    const baseBranch = baseBranchFromLabels(issue.labels) ?? cfg.prBaseBranch;
    try {
      const wt = await createWorktree(projectRoot, probeName, baseBranch, gitRunner);
      workerCwd = wt.cwd;
      branch = wt.branch;
      const wtLayout = projectLayout(wt.cwd);
      scaffoldTasksDir = wtLayout.tasksDir;
      scaffoldStatesDir = wtLayout.statesDir;
      onLog(`  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
      try {
        await seedWorktreeMcpConfig(projectRoot, wt.cwd);
      } catch (err) {
        onLog(
          `! seeding .mcp.json failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    } catch (err) {
      onLog(
        `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — falling back to project root`,
        "yellow",
      );
    }
    return { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch };
  }

  async function prepare(
    issue: LinearIssue,
    mode: SpawnMode,
    trigger?: MentionTrigger,
  ): Promise<PrepareResult> {
    const { workerCwd, scaffoldTasksDir, scaffoldStatesDir, branch } = await setupWorktree(issue);

    let changeName: string;
    // Mode classification: only `fresh` re-scaffolds. resume / conflict-fix /
    // review all reuse the existing change directory.
    const isFresh = mode === "fresh";
    if (isFresh) {
      // Fetch comments to embed in proposal — only on fresh runs to avoid
      // the round-trip cost on every resume/fix.
      let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
      try {
        comments = await fetchIssueComments(apiKey, issue.id);
      } catch (err) {
        onLog(
          `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
      const appendPrompt = args.prompt || cfg.appendPrompt || "";
      changeName = await scaffoldChangeForIssue(
        scaffoldTasksDir,
        scaffoldStatesDir,
        issue,
        comments,
        appendPrompt,
      );
    } else {
      // Resume / conflict-fix: do NOT re-scaffold (would overwrite tasks.md).
      changeName = changeNameForIssue(issue);
      const wtLayout = projectLayout(workerCwd);
      await mkdir(wtLayout.changeDir(changeName), { recursive: true });
      await mkdir(wtLayout.taskStateDir(changeName), { recursive: true });
    }

    cwdByChange.set(changeName, workerCwd);
    statesDirByChange.set(changeName, scaffoldStatesDir);
    issueByChange.set(changeName, issue);
    if (branch) branchByChange.set(changeName, branch);

    if (mode === "review") {
      const wtLayout = projectLayout(workerCwd);
      const tasksFile = join(wtLayout.changeDir(changeName), "tasks.md");
      let body: string;
      let heading: string;
      if (trigger) {
        heading =
          trigger.source === "github"
            ? "Address GitHub @ralphy mention"
            : "Address Linear @ralphy mention";
        body = buildMentionTaskBody(trigger, issue.url);
      } else {
        heading = "Address reviewer comments";
        let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
        try {
          comments = await fetchIssueComments(apiKey, issue.id);
        } catch (err) {
          onLog(
            `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
        const reviewerComments = comments.filter((c) => !isRalphComment(c.body));
        body = buildReviewTaskBody(reviewerComments, issue.url);
      }
      try {
        await prependFixTask(tasksFile, heading, body);
      } catch (err) {
        onLog(`! could not prepend review task: ${(err as Error).message}`, "red");
      }
      await reactivateState(wtLayout.stateFile(changeName), changeName);
    } else if (mode === "conflict-fix") {
      // Prepend a fix-conflicts task and reactivate the loop's state file
      // so the worker picks it up first. The post-task pipeline already
      // handles push (with hook-fix retry) → PR update.
      const wtLayout = projectLayout(workerCwd);
      const tasksFile = join(wtLayout.changeDir(changeName), "tasks.md");
      const prUrl = prByChange.get(changeName);
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
        await prependFixTask(tasksFile, "Resolve PR merge conflicts", body);
      } catch (err) {
        onLog(`! could not prepend conflict-fix task: ${(err as Error).message}`, "red");
      }
      await reactivateState(wtLayout.stateFile(changeName), changeName);
    }

    if (cfg.setupScript) {
      await runScript("setup", cfg.setupScript, workerCwd);
    }

    return {
      changeName,
      ...(prByChange.has(changeName) ? { prUrl: prByChange.get(changeName)! } : {}),
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
      onLog(`! could not reactivate state for ${changeName}: ${(err as Error).message}`, "yellow");
    }
  }

  function buildTaskCmdFor(changeName: string): string[] {
    const c: string[] = [
      process.execPath,
      process.argv[1] ?? "",
      "loop",
      "task",
      "--name",
      changeName,
      "--" + (args.engineSet ? args.engine : cfg.engine),
      args.engineSet ? args.model : cfg.model,
    ];
    const maxIter = args.maxIterations || cfg.maxIterationsPerTask;
    if (maxIter > 0) c.push("--max-iterations", String(maxIter));
    const maxCost = args.maxCostUsd || cfg.maxCostUsdPerTask;
    if (maxCost > 0) c.push("--max-cost", String(maxCost));
    const maxRuntime = args.maxRuntimeMinutes || cfg.maxRuntimeMinutesPerTask;
    if (maxRuntime > 0) c.push("--max-runtime", String(maxRuntime));
    const maxFailures =
      args.maxConsecutiveFailures !== 5
        ? args.maxConsecutiveFailures
        : cfg.maxConsecutiveFailuresPerTask;
    if (maxFailures !== 5) c.push("--max-failures", String(maxFailures));
    const delay = args.delay || cfg.iterationDelaySeconds;
    if (delay > 0) c.push("--delay", String(delay));
    if (args.log || cfg.logRawStream) c.push("--log");
    if (args.verbose || cfg.taskVerbose) c.push("--verbose");
    if (args.manualTest || cfg.enableManualTest) c.push("--manual-test");
    c.push("--from-agent");
    return c;
  }

  /**
   * Default worker spawner: pipes stdout/stderr through a line-buffered
   * splitter that emits each line to `onWorkerOutput` (UI ring buffer) and
   * tees to `<projectRoot>/.ralph/logs/<changeName>.log` so users have
   * both a live tail and a `tail -f`-able file. Tests inject
   * `runners.spawnWorker` to skip the streaming entirely.
   */
  function defaultSpawn(
    changeName: string,
    cmd: string[],
    cwd: string,
    note?: string,
  ): { exited: Promise<number>; kill: () => void; logFilePath: string } {
    const logFilePath = join(logsDir, `${changeName}.log`);
    const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;
    const BOX_ONLY_RE = /^[\s─│╭╮╰╯╌┄━┃]+$/;
    const STATUS_BAR_LINE_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]\s+iter\s+\d+/;
    const ITER_HEADER_LINE_RE = /^──/;
    function isLogWorthy(clean: string): boolean {
      return (
        !BOX_ONLY_RE.test(clean) &&
        !STATUS_BAR_LINE_RE.test(clean) &&
        !ITER_HEADER_LINE_RE.test(clean)
      );
    }
    async function pump(stream: ReadableStream<Uint8Array> | null, label: string): Promise<void> {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            const clean = line.replace(ANSI_RE, "").trim();
            if (clean && isLogWorthy(clean)) logOutput(logFilePath, clean);
            if (line) onWorkerOutput?.(changeName, label === "err" ? `! ${line}` : line);
          }
        }
        if (buf) {
          const clean = buf.replace(ANSI_RE, "").trim();
          if (clean && isLogWorthy(clean)) logOutput(logFilePath, clean);
          onWorkerOutput?.(changeName, label === "err" ? `! ${buf}` : buf);
        }
      } catch {
        /* stream errors are non-fatal — exit drives control flow */
      }
    }
    const p = Bun.spawn({
      cmd,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    void initWorkerLog(logFilePath).then(() => {
      if (note) logSession(note, logFilePath);
    });
    void pump(p.stdout as ReadableStream<Uint8Array>, "out");
    void pump(p.stderr as ReadableStream<Uint8Array>, "err");
    return { exited: p.exited, kill: () => p.kill(), logFilePath };
  }

  function spawnWorker(changeName: string): { exited: Promise<number>; kill: () => void } {
    const cwd = cwdByChange.get(changeName) ?? projectRoot;
    const injected = input.runners?.spawnWorker;

    let logFilePath: string;
    let handle: { exited: Promise<number>; kill: () => void };
    if (injected) {
      logFilePath = join(logsDir, `${changeName}.log`);
      handle = injected(buildTaskCmdFor(changeName), cwd);
    } else {
      const r = defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName),
        cwd,
        `spawn at ${new Date().toISOString()}`,
      );
      logFilePath = r.logFilePath;
      handle = { exited: r.exited, kill: r.kill };
    }
    const respawn = (): Promise<number> => {
      onWorkerPhase?.(changeName, "working", "respawn");
      if (injected) return injected(buildTaskCmdFor(changeName), cwd).exited;
      return defaultSpawn(
        changeName,
        buildTaskCmdFor(changeName),
        cwd,
        `respawn at ${new Date().toISOString()}`,
      ).exited;
    };
    onWorkerStarted(
      changeName,
      statesDirByChange.get(changeName) ?? statesDir,
      logFilePath,
      projectLayout(cwd).changeDir(changeName),
    );
    onWorkerPhase?.(changeName, "working");

    const tracedCmd = onWorkerCmd
      ? traceCmdRunner(
          cmdRunner,
          (cmd) => onWorkerCmd(changeName, cmd, "start"),
          (cmd, ms, ok) => onWorkerCmd(changeName, cmd, "end", ms, ok),
        )
      : cmdRunner;

    const wantPr = args.createPr || cfg.createPrOnSuccess;
    const wantFixCi = args.fixCi || cfg.fixCiOnFailure;
    const issueForChange = issueByChange.get(changeName);
    const wantAutoMerge = issueForChange
      ? issueMatchesGetIndicator(issueForChange, indicators.getAutoMerge)
      : false;
    const wrapped = handle.exited.then(async (code) => {
      const workerLayout = projectLayout(cwd);
      const effectiveCode = await runPostTask(
        {
          changeName,
          cwd,
          projectRoot,
          changeDir: workerLayout.changeDir(changeName),
          stateFilePath: workerLayout.stateFile(changeName),
          branch: branchByChange.get(changeName) ?? null,
          issue: issueByChange.get(changeName) ?? null,
          exitCode: code,
          useWorktree,
          wantPr,
          wantFixCi,
          wantAutoMerge,
          cfg: {
            teardownScript: cfg.teardownScript ?? null,
            prBaseBranch: cfg.prBaseBranch,
            autoMergeStrategy: cfg.autoMergeStrategy,
            maxCiFixAttempts: cfg.maxCiFixAttempts,
            ciPollIntervalSeconds: cfg.ciPollIntervalSeconds,
            cleanupWorktreeOnSuccess: cfg.cleanupWorktreeOnSuccess,
            ignoreCiChecks: cfg.ignoreCiChecks,
            stackPrsOnDependencies: args.stackPrs || cfg.stackPrsOnDependencies,
            manualMergeWhenAutoMergeDisabled: cfg.manualMergeWhenAutoMergeDisabled,
          },
          respawnWorker: respawn,
        },
        {
          cmd: tracedCmd,
          git: gitRunner,
          log: onLog,
          runScript,
          registerPr: (cn, url) => {
            prByChange.set(cn, url);
            prUnavailable.delete(cn);
            input.onWorkerPr?.(cn, url);
          },
          ...(onWorkerPhase && {
            onPhase: (phase: PostTaskPhase, detail?: string) =>
              onWorkerPhase(changeName, phase, detail),
          }),
          checkPrConflict: async (prUrl: string) => {
            // GitHub computes mergeability asynchronously and returns "UNKNOWN"
            // while it works. Retry up to 5 times (10s total) before giving up.
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const res = await tracedCmd.run(
                  ["gh", "pr", "view", prUrl, "--json", "mergeable", "--jq", ".mergeable"],
                  cwd,
                );
                const mergeable = res.stdout.trim();
                if (mergeable !== "UNKNOWN") return mergeable === "CONFLICTING";
              } catch {
                return false;
              }
              await new Promise<void>((r) => setTimeout(r, 2000));
            }
            return false; // still UNKNOWN after retries — assume not conflicting
          },
          resolveDependencyBaseBranch: (issue) =>
            resolveDependencyBaseBranch(issue, tracedCmd, cwd),
        },
      );
      cwdByChange.delete(changeName);
      statesDirByChange.delete(changeName);
      branchByChange.delete(changeName);
      issueByChange.delete(changeName);
      onWorkerExited(changeName);
      return effectiveCode;
    });

    return { exited: wrapped, kill: () => handle.kill() };
  }

  /**
   * Look up the PR for a given issue and ask `gh` whether it's conflicting
   * with main. Returns null when no PR can be found (branch deleted, never
   * created, etc.) — caller skips.
   */
  async function checkPrConflict(
    issue: LinearIssue,
  ): Promise<{ url: string; conflicting: boolean } | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;

    let prUrl: string | undefined = prByChange.get(changeName);
    if (!prUrl) {
      const found = await discoverPrUrl(issue, changeName);
      if (!found) return null;
      prUrl = found;
      prByChange.set(changeName, prUrl);
    }

    // GitHub computes mergeability asynchronously; the scan path used to
    // accept the first UNKNOWN as "not conflicting" and silently move on
    // until the next poll, which would re-issue gh and again hit UNKNOWN.
    // Retry up to 3 times (6s total) before giving up for this poll.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await cmdRunner.run(
          ["gh", "pr", "view", prUrl, "--json", "mergeable", "--jq", ".mergeable"],
          projectRoot,
        );
        const mergeable = res.stdout.trim();
        if (mergeable !== "UNKNOWN") {
          return { url: prUrl, conflicting: mergeable === "CONFLICTING" };
        }
      } catch (err) {
        onLog(`! gh pr view ${prUrl} failed (conflict scan): ${(err as Error).message}`, "yellow");
        return null;
      }
      await new Promise<void>((r) => setTimeout(r, 2000));
    }
    onLog(
      `  ${issue.identifier}: mergeability still UNKNOWN after retries (${prUrl}) — will recheck next poll`,
      "gray",
    );
    return null;
  }

  /** Soft-TTL helpers for the prUnavailable cache. */
  function isPrUnavailable(changeName: string): boolean {
    const expiry = prUnavailable.get(changeName);
    if (expiry === undefined) return false;
    if (Date.now() >= expiry) {
      prUnavailable.delete(changeName);
      return false;
    }
    return true;
  }
  function markPrUnavailable(changeName: string): void {
    prUnavailable.set(changeName, Date.now() + PR_UNAVAILABLE_TTL_MS);
  }

  /**
   * Discover the PR URL for an issue. Tries two strategies in order:
   *   1. `gh pr list --head ralph/<changeName>` — the branch ralphy
   *      creates. Cheap and works while branch naming is intact.
   *   2. Linear attachments — Linear's GitHub integration auto-attaches
   *      the PR URL to the issue when the PR references the Linear
   *      identifier (title / body / branch / commit). Canonical fallback
   *      that handles branch-name drift, manual renames, or PRs opened
   *      by hand outside ralph's worktree path.
   * Each failure logs once so the dashboard surfaces what's happening.
   */
  async function discoverPrUrl(issue: LinearIssue, changeName: string): Promise<string | null> {
    const branch = branchForChange(changeName);
    const tryGh = async (args: string[]): Promise<string | null> => {
      try {
        const res = await cmdRunner.run(args, projectRoot);
        const found = res.stdout.trim();
        return found || null;
      } catch (err) {
        onLog(
          `! gh ${args[1] ?? ""} failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        return null;
      }
    };

    const byBranch = await tryGh([
      "gh",
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
    ]);
    if (byBranch) return byBranch;

    const fromLinear = await discoverPrUrlFromLinear(issue);
    if (fromLinear) {
      onLog(`  ${issue.identifier}: PR discovered via Linear attachment (${fromLinear})`, "gray");
      return fromLinear;
    }

    onLog(
      `  ${issue.identifier}: no open PR found on head=${branch} or Linear attachments; conflict scan skipped for ${PR_UNAVAILABLE_TTL_MS / 60000}m`,
      "gray",
    );
    markPrUnavailable(changeName);
    return null;
  }

  /**
   * Resolve the head branch of a blocker's single open GitHub PR for a given
   * issue. Used by the post-task PR phase when `stackPrsOnDependencies` is on:
   * a new PR is opened against this branch instead of `prBaseBranch` so the
   * dependent change stacks on top of its dependency.
   *
   * Returns null when there are zero or multiple blockers with open PRs, when
   * a blocker has multiple open PRs, or when any lookup fails — callers fall
   * back to the configured base branch in those cases.
   */
  async function resolveDependencyBaseBranch(
    issue: LinearIssue,
    runner: CmdRunner,
    runnerCwd: string,
  ): Promise<string | null> {
    const blockerIds = issue.blockedByIds;
    if (blockerIds.length === 0) return null;

    const candidates: string[] = [];
    for (const blockerId of blockerIds) {
      let attachments;
      try {
        attachments = await fetchIssueAttachments(apiKey, blockerId);
      } catch (err) {
        onLog(
          `! could not fetch attachments for blocker ${blockerId} of ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      const prUrls = attachments
        .map((a) => a.url)
        .filter((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url));
      const openHeads: string[] = [];
      for (const url of prUrls) {
        try {
          const res = await runner.run(
            ["gh", "pr", "view", url, "--json", "state,headRefName", "--jq", "."],
            runnerCwd,
          );
          const parsed = JSON.parse(res.stdout.trim()) as {
            state?: string;
            headRefName?: string;
          };
          if (parsed.state === "OPEN" && parsed.headRefName) {
            openHeads.push(parsed.headRefName);
          }
        } catch (err) {
          onLog(
            `! gh pr view failed for ${url} (blocker of ${issue.identifier}): ${(err as Error).message}`,
            "yellow",
          );
        }
      }
      if (openHeads.length === 1) {
        candidates.push(openHeads[0] as string);
      } else if (openHeads.length > 1) {
        onLog(
          `  ${issue.identifier}: blocker ${blockerId} has ${openHeads.length} open PRs — skipping dependency base resolution`,
          "gray",
        );
      }
    }

    if (candidates.length === 1) return candidates[0] as string;
    if (candidates.length > 1) {
      onLog(
        `  ${issue.identifier}: ${candidates.length} blockers have open PRs — falling back to default base`,
        "gray",
      );
    }
    return null;
  }

  /** Pull GitHub PR URLs off the issue's Linear attachments. Linear's
   *  GitHub integration creates these automatically when a PR references
   *  the Linear identifier. Returns the newest matching PR URL, or null. */
  async function discoverPrUrlFromLinear(issue: LinearIssue): Promise<string | null> {
    try {
      const attachments = await fetchIssueAttachments(apiKey, issue.id);
      const match = attachments.find((a) =>
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(a.url),
      );
      return match?.url ?? null;
    } catch (err) {
      onLog(
        `! Linear attachments fetch failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return null;
    }
  }

  // setDone candidates for conflict scan: include = setDone marker(s),
  // exclude = setConflicted marker(s) (don't double-count).
  async function fetchDoneCandidates(): Promise<LinearIssue[]> {
    if (!indicators.setDone) return [];
    const include = markersOf(indicators.setDone);
    const exclude = indicators.setConflicted ? markersOf(indicators.setConflicted) : [];
    if (include.length === 0) return [];
    return fetchOpenIssues(apiKey, { team, assignee, include, exclude });
  }

  /**
   * Scan done-issue comments (Linear + linked GitHub PR) for unprocessed
   * `@<handle>` mentions. A mention is unprocessed when its createdAt is
   * newer than the latest Ralph "🔁 picked up" comment on the Linear
   * issue (Linear is the single source of truth for "last processed",
   * regardless of where the mention came from).
   *
   * Best-effort: any failure (Linear API, gh CLI missing, malformed PR URL)
   * logs and is skipped — never throws into the poll loop.
   */
  async function fetchMentions(): Promise<{ issue: LinearIssue; trigger: MentionTrigger }[]> {
    const wantMention = cfg.linear.mentionTrigger;
    const wantCodeReview = args.codeReview || cfg.linear.codeReviewTrigger;
    if (!wantMention && !wantCodeReview) return [];
    const handle = cfg.linear.mentionHandle;
    let candidates: LinearIssue[] = [];
    try {
      candidates = await fetchDoneCandidates();
    } catch (err) {
      onLog(`! mention scan: fetchDoneCandidates failed: ${(err as Error).message}`, "yellow");
      return [];
    }
    const out: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
    const queued = new Set<string>();
    for (const issue of candidates) {
      let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
      try {
        comments = await fetchIssueComments(apiKey, issue.id);
      } catch (err) {
        onLog(
          `! mention scan: Linear comments failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      const lastRalphPickup = findLastRalphPickupISO(comments);

      if (wantMention) {
        for (const c of comments) {
          if (isRalphComment(c.body)) continue;
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
          out.push({
            issue,
            trigger: {
              source: "linear",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.user?.name ? { author: c.user.name } : {}),
              url: issue.url,
            },
          });
          queued.add(issue.id);
          break;
        }
        if (queued.has(issue.id)) continue;
      }

      // Anything below needs a tracked PR.
      const prUrl = await resolvePrUrlForIssue(issue);
      if (!prUrl) continue;

      if (wantMention) {
        const ghComments = await fetchPrIssueComments(prUrl);
        for (const c of ghComments) {
          if (!containsHandle(c.body, handle)) continue;
          if (lastRalphPickup && c.createdAt <= lastRalphPickup) continue;
          out.push({
            issue,
            trigger: {
              source: "github",
              body: c.body,
              createdAt: c.createdAt,
              ...(c.author ? { author: c.author } : {}),
              url: c.url,
            },
          });
          queued.add(issue.id);
          break;
        }
        if (queued.has(issue.id)) continue;
      }

      if (wantCodeReview) {
        const trigger = await scanCodeReview(issue, prUrl, lastRalphPickup);
        if (trigger) {
          out.push({ issue, trigger });
          queued.add(issue.id);
        }
      }
    }
    return out;
  }

  /**
   * Inspect an open PR for unresolved review-thread comments. Returns a
   * `github-review` trigger if there is at least one reviewer comment
   * newer than Ralph's last `🔁 picked up` ack. Otherwise, if the PR is
   * stalled (Ralph is the last actor, > codeReviewStaleHours since the
   * reviewer's most recent activity), posts a one-shot ping comment on
   * the GitHub PR and returns null.
   *
   * Best-effort throughout — any failure logs and returns null so the
   * caller continues with the next candidate.
   */
  async function scanCodeReview(
    issue: LinearIssue,
    prUrl: string,
    lastRalphPickup: string | null,
  ): Promise<MentionTrigger | null> {
    const state = await fetchPrReviewState(prUrl);
    if (!state || !state.isOpen || state.merged || state.approved) return null;
    const unresolved = state.threads.filter((t) => !t.isResolved && t.comments.length > 0);
    if (unresolved.length === 0) return null;
    const newestReviewerActivity = unresolved.reduce<string>((acc, t) => {
      const last = t.comments[t.comments.length - 1]!.createdAt;
      return last > acc ? last : acc;
    }, "");
    if (!lastRalphPickup || newestReviewerActivity > lastRalphPickup) {
      const body = unresolved
        .map((t) => {
          const head = t.path ? `_${t.path}${t.line ? `:${t.line}` : ""}_` : "_(general)_";
          const lines = t.comments.map(
            (c) =>
              `> **${c.author ?? "reviewer"}** (${c.createdAt})\n>\n> ${c.body.trim().replace(/\n/g, "\n> ")}`,
          );
          return [head, "", ...lines].join("\n");
        })
        .join("\n\n---\n\n");
      return {
        source: "github-review",
        body,
        createdAt: newestReviewerActivity || new Date().toISOString(),
        ...(state.lastReviewer ? { author: state.lastReviewer } : {}),
        url: prUrl,
      };
    }
    await maybePingStaleReviewer(issue, prUrl, state, newestReviewerActivity);
    return null;
  }

  /** Post a single GitHub PR ping comment when Ralph has been waiting on
   *  a reviewer for >codeReviewStaleHours. Idempotent via prByPinged. */
  async function maybePingStaleReviewer(
    issue: LinearIssue,
    prUrl: string,
    state: PrReviewState,
    newestReviewerActivity: string,
  ): Promise<void> {
    const staleHours = cfg.linear.codeReviewStaleHours;
    if (staleHours <= 0) return;
    const reviewer = state.requestedReviewer ?? state.lastReviewer;
    if (!reviewer) return;
    const lastPinged = stalePingedAt.get(prUrl);
    const now = Date.now();
    if (lastPinged && now - lastPinged < staleHours * 3600_000) return;
    const elapsedH = newestReviewerActivity
      ? (now - Date.parse(newestReviewerActivity)) / 3600_000
      : Infinity;
    if (elapsedH < staleHours) return;
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
    if (!m) return;
    const [, owner, repo, num] = m;
    const body = `🔔 @${reviewer} — Ralph has been waiting ${elapsedH.toFixed(0)}h on a re-review for ${prUrl}. Could you take another look when you have a moment?`;
    try {
      await cmdRunner.run(
        ["gh", "api", `repos/${owner}/${repo}/issues/${num}/comments`, "-f", `body=${body}`],
        projectRoot,
      );
      stalePingedAt.set(prUrl, now);
      onLog(`  ${issue.identifier}: pinged reviewer @${reviewer} on ${prUrl}`, "gray");
    } catch (err) {
      onLog(`! reviewer ping failed for ${prUrl}: ${(err as Error).message}`, "yellow");
    }
  }

  interface PrReviewThreadComment {
    author?: string;
    body: string;
    createdAt: string;
    url?: string;
  }
  interface PrReviewThread {
    isResolved: boolean;
    path?: string;
    line?: number;
    comments: PrReviewThreadComment[];
  }
  interface PrReviewState {
    isOpen: boolean;
    merged: boolean;
    approved: boolean;
    threads: PrReviewThread[];
    requestedReviewer?: string;
    lastReviewer?: string;
  }

  /** Query the PR's review state + threads via the GraphQL endpoint.
   *  Returns null on any error so the scan loop continues. */
  async function fetchPrReviewState(prUrl: string): Promise<PrReviewState | null> {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
    if (!m) return null;
    const [, owner, repo, num] = m;
    const query = `query($owner:String!,$repo:String!,$num:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$num){
          state merged reviewDecision
          reviewRequests(first:5){nodes{requestedReviewer{... on User{login}}}}
          latestReviews(first:5){nodes{author{login} state submittedAt}}
          reviewThreads(first:50){nodes{
            isResolved path line
            comments(first:20){nodes{body author{login} createdAt url}}
          }}
        }
      }
    }`;
    try {
      const res = await cmdRunner.run(
        [
          "gh",
          "api",
          "graphql",
          "-f",
          `query=${query}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `repo=${repo}`,
          "-F",
          `num=${num}`,
        ],
        projectRoot,
      );
      const parsed = JSON.parse(res.stdout) as {
        data?: {
          repository?: {
            pullRequest?: {
              state: string;
              merged: boolean;
              reviewDecision: string | null;
              reviewRequests?: { nodes: { requestedReviewer?: { login?: string } | null }[] };
              latestReviews?: {
                nodes: { author?: { login?: string } | null; state: string; submittedAt: string }[];
              };
              reviewThreads?: {
                nodes: {
                  isResolved: boolean;
                  path?: string | null;
                  line?: number | null;
                  comments: {
                    nodes: {
                      body: string;
                      author?: { login?: string } | null;
                      createdAt: string;
                      url?: string;
                    }[];
                  };
                }[];
              };
            } | null;
          } | null;
        };
      };
      const pr = parsed.data?.repository?.pullRequest;
      if (!pr) return null;
      const requested = pr.reviewRequests?.nodes
        .map((n) => n.requestedReviewer?.login)
        .filter((x): x is string => !!x)[0];
      const latestReviews = pr.latestReviews?.nodes ?? [];
      const lastReviewer = latestReviews
        .slice()
        .sort((a, b) => (b.submittedAt > a.submittedAt ? 1 : -1))
        .map((n) => n.author?.login)
        .filter((x): x is string => !!x)[0];
      return {
        isOpen: pr.state === "OPEN",
        merged: pr.merged,
        approved: pr.reviewDecision === "APPROVED",
        threads: (pr.reviewThreads?.nodes ?? []).map((t) => ({
          isResolved: t.isResolved,
          ...(t.path ? { path: t.path } : {}),
          ...(t.line != null ? { line: t.line } : {}),
          comments: t.comments.nodes.map((c) => ({
            ...(c.author?.login ? { author: c.author.login } : {}),
            body: c.body,
            createdAt: c.createdAt,
            ...(c.url ? { url: c.url } : {}),
          })),
        })),
        ...(requested ? { requestedReviewer: requested } : {}),
        ...(lastReviewer ? { lastReviewer } : {}),
      };
    } catch (err) {
      onLog(`! gh graphql review-state failed for ${prUrl}: ${(err as Error).message}`, "yellow");
      return null;
    }
  }

  /** Newest ISO timestamp from Ralph's `🔁 picked up` review acks, or null. */
  function findLastRalphPickupISO(comments: { body: string; createdAt: string }[]): string | null {
    let latest: string | null = null;
    for (const c of comments) {
      if (!/^🔁\s*Ralph picked up/.test(c.body.trimStart())) continue;
      if (latest === null || c.createdAt > latest) latest = c.createdAt;
    }
    return latest;
  }

  function containsHandle(body: string, handle: string): boolean {
    const re = new RegExp(`(^|\\s|[^A-Za-z0-9_])${escapeRegex(handle)}\\b`, "i");
    return re.test(body);
  }

  /** Resolve the PR URL for an issue's tracked change, if any. Reuses the
   *  conflict-scan discovery so branch-name drift falls back to title
   *  search. Returns null silently for non-tracked PRs. */
  async function resolvePrUrlForIssue(issue: LinearIssue): Promise<string | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;
    const cached = prByChange.get(changeName);
    if (cached) return cached;
    const found = await discoverPrUrl(issue, changeName);
    if (found) prByChange.set(changeName, found);
    return found;
  }

  /** Fetch issue-level comments on a PR (i.e. the conversation tab).
   *  Review-thread comments aren't included — they're tied to specific
   *  diff hunks and are out of scope for this trigger. */
  async function fetchPrIssueComments(
    prUrl: string,
  ): Promise<{ body: string; createdAt: string; author?: string; url: string }[]> {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
    if (!m) return [];
    const [, owner, repo, num] = m;
    try {
      const res = await cmdRunner.run(
        [
          "gh",
          "api",
          `repos/${owner}/${repo}/issues/${num}/comments`,
          "--jq",
          "[.[] | {body: .body, createdAt: .created_at, author: .user.login, url: .html_url}]",
        ],
        projectRoot,
      );
      const parsed = JSON.parse(res.stdout || "[]") as {
        body: string;
        createdAt: string;
        author?: string;
        url: string;
      }[];
      return parsed;
    } catch (err) {
      onLog(`! mention scan: gh comments failed for ${prUrl}: ${(err as Error).message}`, "yellow");
      return [];
    }
  }

  const coord = new AgentCoordinator(
    {
      fetchTodo: () => fetchByGet(indicators.getTodo, excludeFromTodo),
      fetchInProgress: () => fetchByGet(indicators.getInProgress, []),
      fetchConflicted: () => fetchByGet(indicators.getConflicted, []),
      fetchReview: () => fetchByGet(indicators.getReview, excludeFromReview),
      fetchMentions,
      fetchDoneCandidates,
      prepare,
      spawnWorker,
      applyIndicator,
      removeIndicator,
      postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
      fetchComments: async (issueId) => {
        const c = await fetchIssueComments(apiKey, issueId);
        return c.map((x) => ({ body: x.body }));
      },
      checkPrConflict,
      onLog,
      onWorkersChanged,
      getIterationCount: async (changeName) => {
        const root = cwdByChange.get(changeName) ?? projectRoot;
        const file = Bun.file(projectLayout(root).stateFile(changeName));
        if (!(await file.exists())) return 0;
        const json = (await file.json()) as { iteration?: number };
        return json.iteration ?? 0;
      },
    },
    {
      concurrency,
      ...(indicators.setInProgress !== undefined
        ? { setInProgress: indicators.setInProgress }
        : {}),
      ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
      ...(indicators.setError !== undefined ? { setError: indicators.setError } : {}),
      ...(indicators.setConflicted !== undefined
        ? { setConflicted: indicators.setConflicted }
        : {}),
      ...(indicators.clearConflicted !== undefined
        ? { clearConflicted: indicators.clearConflicted }
        : {}),
      ...(indicators.clearReview !== undefined ? { clearReview: indicators.clearReview } : {}),
      postComments: cfg.linear.postComments,
      commentEveryIterations: cfg.linear.updateEveryIterations,
      ...(args.maxTickets > 0 ? { maxTickets: args.maxTickets } : {}),
    },
  );

  const filterDesc = describeIndicators(indicators, team, assignee);

  return {
    coord,
    filterDesc,
    concurrency,
    pollInterval,
    getWorkerCwd: (changeName) => cwdByChange.get(changeName),
  };
}

function describeIndicators(
  indicators: Indicators,
  team: string | undefined,
  assignee: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(`team=${team ?? "*"}`);
  parts.push(`assignee=${assignee ?? "*"}`);
  if (indicators.getTodo) {
    parts.push(`todo=[${indicators.getTodo.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`);
  }
  if (indicators.getInProgress) {
    parts.push(
      `inProgress=[${indicators.getInProgress.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`,
    );
  }
  if (indicators.getConflicted) {
    parts.push(
      `conflicted=[${indicators.getConflicted.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`,
    );
  }
  if (indicators.getReview) {
    parts.push(
      `review=[${indicators.getReview.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`,
    );
  }
  return parts.join(", ");
}
