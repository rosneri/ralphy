import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ParsedArgs } from "../cli";
import {
  fetchOpenIssues,
  addIssueComment,
  fetchIssueComments,
  fetchWorkflowStates,
  updateIssueState,
  fetchIssueLabels,
  addLabelToIssue,
  type LinearIssue,
} from "../agent/linear";
import { readAgentState, writeAgentState } from "../agent/state";
import { scaffoldChangeForIssue } from "../agent/scaffold";
import { ensureRalphyConfig, loadRalphyConfig } from "../agent/config";
import { AgentCoordinator } from "../agent/coordinator";
import { createWorktree, removeWorktree, type GitRunner } from "../agent/worktree";
import { createPullRequest, type CmdRunner } from "../agent/pr";
import { fixCiUntilGreen, getPrChecksStatus, fetchFailedRunLogs } from "../agent/ci";
import { join } from "node:path";

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

interface AgentModeProps {
  args: ParsedArgs;
  projectRoot: string;
  statesDir: string;
  tasksDir: string;
}

interface LogLine {
  id: string;
  text: string;
  color?: string | undefined;
}

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `${Date.now()}-${lineCounter}`;
}

interface WorkerMeta {
  startedAt: number;
  statesDir: string;
  iter: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, "0")}m`;
}

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  const coordRef = useRef<AgentCoordinator | null>(null);
  const workerMetaRef = useRef<Map<string, WorkerMeta>>(new Map());
  const nextPollAtRef = useRef<number>(0);
  const pollIntervalRef = useRef<number>(0);
  const [pollStatus, setPollStatus] = useState<{
    state: "idle" | "polling";
    lastFound: number | null;
    lastAdded: number | null;
    lastAt: number | null;
    filterDesc: string;
  }>({ state: "idle", lastFound: null, lastAdded: null, lastAt: null, filterDesc: "" });

  function appendLog(text: string, color?: string) {
    setLogs((prev) => [...prev, { id: nextId(), text, color }]);
  }

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function init() {
      const cfgPath = await ensureRalphyConfig(projectRoot);
      const cfg = await loadRalphyConfig(projectRoot);
      appendLog(`agent mode — config: ${cfgPath}`, "gray");

      const concurrency = args.concurrency || cfg.concurrency;
      const pollInterval = args.pollInterval || cfg.pollIntervalSeconds;
      pollIntervalRef.current = pollInterval;
      appendLog(`concurrency=${concurrency} pollInterval=${pollInterval}s`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        appendLog("! LINEAR_API_KEY not set — cannot poll Linear", "red");
        exit();
        return;
      }

      const inProgressName = args.inProgressStatus || cfg.linear.inProgressStatus;
      const baseStatuses = args.linearStatus.length ? args.linearStatus : cfg.linear.statuses;
      // Always include `inProgressStatus` in the effective filter when one
      // is configured, so issues left in flight by an interrupted previous
      // run are picked up again on restart. (Workers are deduped against
      // .ralph/agent-state.json, so we won't double-process.)
      const effectiveStatuses =
        inProgressName && baseStatuses.length > 0 && !baseStatuses.includes(inProgressName)
          ? [...baseStatuses, inProgressName]
          : baseStatuses;
      const filter = {
        team: args.linearTeam || cfg.linear.team,
        assignee: args.linearAssignee || cfg.linear.assignee,
        statuses: effectiveStatuses,
        labels: args.linearLabel.length ? args.linearLabel : cfg.linear.labels,
      };

      // Caches: teamKey -> Map<lowercased name, id>
      const stateCache = new Map<string, Map<string, string>>();
      const labelCache = new Map<string, Map<string, string>>();
      const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

      const useWorktree = args.worktree || cfg.useWorktree;
      // Per-changeName: cwd to spawn the worker in (worktree path if enabled,
      // else projectRoot).
      const cwdByChange = new Map<string, string>();
      const statesDirByChange = new Map<string, string>();
      const branchByChange = new Map<string, string>();
      const issueByChange = new Map<string, LinearIssue>();

      async function runScript(label: string, cmd: string, cwd: string): Promise<void> {
        appendLog(`  ${label}: ${cmd}`, "gray");
        const proc = Bun.spawn({
          cmd: ["sh", "-c", cmd],
          cwd,
          stdout: "ignore",
          stderr: "pipe",
          stdin: "ignore",
        });
        const code = await proc.exited;
        if (code !== 0) {
          const stderr = await new Response(proc.stderr).text();
          appendLog(
            `! ${label} exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
            "yellow",
          );
        }
      }

      const coord = new AgentCoordinator(
        {
          fetchIssues: (f) => fetchOpenIssues(apiKey, f),
          scaffold: async (issue) => {
            let comments: Awaited<ReturnType<typeof fetchIssueComments>> = [];
            try {
              comments = await fetchIssueComments(apiKey, issue.id);
            } catch (err) {
              appendLog(
                `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
                "yellow",
              );
            }

            // Decide where this change's files live:
            //  - useWorktree: scaffold inside the worktree so the loop sees them
            //  - else: scaffold in main project root
            let workerCwd = projectRoot;
            let scaffoldTasksDir = tasksDir;
            let scaffoldStatesDir = statesDir;
            let workerBranch: string | null = null;
            const probeName = issue.identifier.toLowerCase();
            if (useWorktree) {
              try {
                const wt = await createWorktree(projectRoot, probeName, bunGitRunner);
                workerCwd = wt.cwd;
                workerBranch = wt.branch;
                scaffoldTasksDir = join(wt.cwd, "openspec", "changes");
                scaffoldStatesDir = join(wt.cwd, ".ralph", "tasks");
                appendLog(`  ${issue.identifier} worktree: ${wt.cwd} (${wt.branch})`, "gray");
              } catch (err) {
                appendLog(
                  `! worktree create failed for ${issue.identifier}: ${(err as Error).message} — falling back to project root`,
                  "yellow",
                );
              }
            }

            const appendPrompt = args.prompt || cfg.appendPrompt || "";
            const changeName = await scaffoldChangeForIssue(
              scaffoldTasksDir,
              scaffoldStatesDir,
              issue,
              comments,
              appendPrompt,
            );
            cwdByChange.set(changeName, workerCwd);
            statesDirByChange.set(changeName, scaffoldStatesDir);
            issueByChange.set(changeName, issue);
            if (workerBranch) branchByChange.set(changeName, workerBranch);

            // Persist a change-name → issue mapping so `ralph clean --name` can
            // later remove the issue ID from processed/startedIssueIds.
            try {
              const s = await readAgentState(projectRoot);
              s.changeMeta[changeName] = { issueId: issue.id, identifier: issue.identifier };
              await writeAgentState(projectRoot, s);
            } catch (err) {
              appendLog(
                `! failed to record agent meta for ${changeName}: ${(err as Error).message}`,
                "yellow",
              );
            }

            if (cfg.setupScript) {
              await runScript("setup", cfg.setupScript, workerCwd);
            }

            return changeName;
          },
          spawnWorker: (changeName) => {
            const buildTaskCmd = (): string[] => {
              const c: string[] = [
                process.execPath,
                process.argv[1] ?? "",
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
              // --max-failures default (5) is preserved by the worker; only
              // forward when CLI/config explicitly differ from the default.
              const maxFailures =
                args.maxConsecutiveFailures !== 5
                  ? args.maxConsecutiveFailures
                  : cfg.maxConsecutiveFailuresPerTask;
              if (maxFailures !== 5) c.push("--max-failures", String(maxFailures));
              const delay = args.delay || cfg.iterationDelaySeconds;
              if (delay > 0) c.push("--delay", String(delay));
              if (args.log || cfg.logRawStream) c.push("--log");
              if (args.verbose || cfg.taskVerbose) c.push("--verbose");
              return c;
            };

            const cwd = cwdByChange.get(changeName) ?? projectRoot;
            const proc = Bun.spawn({
              cmd: buildTaskCmd(),
              cwd,
              stdout: "ignore",
              stderr: "ignore",
              stdin: "ignore",
            });
            workerMetaRef.current.set(changeName, {
              startedAt: Date.now(),
              statesDir: statesDirByChange.get(changeName) ?? statesDir,
              iter: 0,
            });

            // Wrap exited so we can run teardown + worktree cleanup before
            // the coordinator sees the exit code.
            const wantPr = args.createPr || cfg.createPrOnSuccess;
            // CI-fix exit code: when fix-CI is enabled and CI never goes
            // green, we override the worker's exit code to non-zero so the
            // coordinator skips doneStatus/doneLabel and won't mark the
            // issue as processed. Picked-up again on the next poll (the
            // resume-in-progress logic ensures it's still in the filter).
            const CI_FAILED_EXIT = 70;
            const PR_FAILED_EXIT = 71;
            const wrapped = proc.exited.then(async (code) => {
              if (cfg.teardownScript) {
                try {
                  await runScript("teardown", cfg.teardownScript, cwd);
                } catch {
                  /* runScript already logs */
                }
              }
              let effectiveCode = code;
              const ok = code === 0;
              if (ok && wantPr) {
                const branch = branchByChange.get(changeName);
                const prIssue = issueByChange.get(changeName);
                if (!branch || !prIssue) {
                  appendLog(
                    `! createPr requested but no worktree branch is tracked for ${changeName} (use --worktree)`,
                    "yellow",
                  );
                  effectiveCode = PR_FAILED_EXIT;
                } else {
                  try {
                    const pr = await createPullRequest(
                      { cwd, branch, issue: prIssue, base: cfg.prBaseBranch },
                      bunCmdRunner,
                    );
                    if (!pr) {
                      appendLog(`  no commits ahead of ${cfg.prBaseBranch} — skipping PR`, "gray");
                    } else {
                      appendLog(
                        `  ${pr.created ? "opened" : "found existing"} PR: ${pr.url}`,
                        "green",
                      );

                      const wantFixCi = args.fixCi || cfg.fixCiOnFailure;
                      if (wantFixCi) {
                        appendLog(
                          `  watching CI for ${pr.url} (max ${cfg.maxCiFixAttempts} fix attempts)`,
                          "gray",
                        );
                        const proposalPath = join(
                          statesDirByChange.get(changeName) ?? statesDir,
                          "..",
                          "..",
                          "openspec",
                          "changes",
                          changeName,
                          "proposal.md",
                        );
                        const result = await fixCiUntilGreen(
                          {
                            getStatus: () => getPrChecksStatus(pr.url, bunCmdRunner, cwd),
                            getFailedLogs: (ids) => fetchFailedRunLogs(ids, bunCmdRunner, cwd),
                            runTaskWithSteering: async (steering) => {
                              try {
                                const file = Bun.file(proposalPath);
                                const prev = (await file.exists()) ? await file.text() : "";
                                const stamped = `\n\n### CI feedback (${new Date().toISOString()})\n\n${steering}\n`;
                                const next = prev.includes("## Steering")
                                  ? prev.replace(
                                      /## Steering\n+([\s\S]*?)$/,
                                      (_m, rest) => `## Steering\n${stamped}\n${rest}`,
                                    )
                                  : prev + `\n## Steering\n${stamped}\n`;
                                await Bun.write(proposalPath, next);
                              } catch (err) {
                                appendLog(
                                  `! could not append steering: ${(err as Error).message}`,
                                  "red",
                                );
                              }
                              const p = Bun.spawn({
                                cmd: buildTaskCmd(),
                                cwd,
                                stdout: "ignore",
                                stderr: "ignore",
                                stdin: "ignore",
                              });
                              return p.exited;
                            },
                            pushBranch: async () => {
                              await bunCmdRunner.run(["git", "push", "origin", branch], cwd);
                            },
                            log: appendLog,
                            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                          },
                          {
                            maxAttempts: cfg.maxCiFixAttempts,
                            pollIntervalSeconds: cfg.ciPollIntervalSeconds,
                          },
                        );
                        if (!result.success) {
                          appendLog(
                            `! CI fix loop gave up after ${result.attempts} attempts (${result.reason ?? "unknown"}) — withholding done-status until CI passes`,
                            "red",
                          );
                          effectiveCode = CI_FAILED_EXIT;
                        }
                      }
                    }
                  } catch (err) {
                    const e = err as Error & { stderr?: string; code?: number };
                    const detail = e.stderr?.trim() || e.message;
                    appendLog(
                      `! PR create failed for ${changeName}: ${detail}`,
                      "red",
                    );
                    effectiveCode = PR_FAILED_EXIT;
                  }
                }
              }
              if (useWorktree && cwd !== projectRoot) {
                // Only clean up the worktree on full success — that includes
                // CI passing when fix-CI is on. Failed CI keeps the worktree
                // and branch for human inspection on the existing PR.
                if (effectiveCode === 0 && cfg.cleanupWorktreeOnSuccess) {
                  try {
                    await removeWorktree(projectRoot, cwd, bunGitRunner);
                    appendLog(`  removed worktree ${cwd}`, "gray");
                  } catch (err) {
                    appendLog(
                      `! worktree remove failed for ${changeName}: ${(err as Error).message}`,
                      "yellow",
                    );
                  }
                }
              }
              cwdByChange.delete(changeName);
              statesDirByChange.delete(changeName);
              branchByChange.delete(changeName);
              issueByChange.delete(changeName);
              workerMetaRef.current.delete(changeName);
              return effectiveCode;
            });

            return { exited: wrapped, kill: () => proc.kill() };
          },
          loadState: () => readAgentState(projectRoot),
          saveState: (s) => writeAgentState(projectRoot, s),
          onLog: appendLog,
          onWorkersChanged: () => setTick((t) => t + 1),
          getIterationCount: async (changeName) => {
            const dir = statesDirByChange.get(changeName) ?? statesDir;
            const file = Bun.file(join(dir, changeName, ".ralph-state.json"));
            if (!(await file.exists())) return 0;
            const json = (await file.json()) as { iteration?: number };
            return json.iteration ?? 0;
          },
          updater: {
            postComment: (issue, body) => addIssueComment(apiKey, issue.id, body),
            setState: (issue, stateId) => updateIssueState(apiKey, issue.id, stateId),
            resolveStateId: async (issue, stateName) => {
              const team = teamKeyOf(issue);
              let map = stateCache.get(team);
              if (!map) {
                const states = await fetchWorkflowStates(apiKey, team);
                map = new Map(states.map((s) => [s.name.toLowerCase(), s.id]));
                stateCache.set(team, map);
              }
              return map.get(stateName.toLowerCase()) ?? null;
            },
            addLabel: (issue, labelId) => addLabelToIssue(apiKey, issue.id, labelId),
            resolveLabelId: async (issue, labelName) => {
              const team = teamKeyOf(issue);
              let map = labelCache.get(team);
              if (!map) {
                const labels = await fetchIssueLabels(apiKey, team);
                map = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
                labelCache.set(team, map);
              }
              return map.get(labelName.toLowerCase()) ?? null;
            },
          },
        },
        {
          concurrency,
          filter,
          inProgressStatus: args.inProgressStatus || cfg.linear.inProgressStatus,
          doneStatus: args.doneStatus || cfg.linear.doneStatus,
          doneLabel: args.doneLabel || cfg.linear.doneLabel,
          postComments: cfg.linear.postComments,
          commentEveryIterations: cfg.linear.updateEveryIterations,
        },
      );
      coordRef.current = coord;
      await coord.init();

      const filterDesc = `team=${filter.team ?? "*"}, assignee=${filter.assignee ?? "*"}, statuses=${
        filter.statuses?.length ? filter.statuses.join(",") : "open"
      }${filter.labels?.length ? `, labels=${filter.labels.join(",")}` : ""}`;
      const tick = async () => {
        if (cancelled) return;
        setPollStatus((p) => ({ ...p, state: "polling", filterDesc }));
        const { found, added } = await coord.pollOnce();
        if (cancelled) return;
        // Only emit a log line when something new was queued — steady-state
        // polls are noisy and visible in the live footer instead.
        if (added > 0) {
          appendLog(`  ${added} new issue${added === 1 ? "" : "s"} queued (found ${found} open)`);
        }
        setPollStatus({
          state: "idle",
          lastFound: found,
          lastAdded: added,
          lastAt: Date.now(),
          filterDesc,
        });
        nextPollAtRef.current = Date.now() + pollInterval * 1000;
        pollTimer = setTimeout(tick, pollInterval * 1000);
      };
      void tick();
    }

    void init();

    const onSig = () => {
      cancelled = true;
      appendLog("stopping agent — sending SIGTERM to workers", "yellow");
      coordRef.current?.stop();
      if (pollTimer) clearTimeout(pollTimer);
      exit();
    };
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      coordRef.current?.stop();
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      void (async () => {
        for (const [changeName, meta] of workerMetaRef.current) {
          try {
            const file = Bun.file(join(meta.statesDir, changeName, ".ralph-state.json"));
            if (await file.exists()) {
              const json = (await file.json()) as { iteration?: number };
              meta.iter = json.iteration ?? meta.iter;
            }
          } catch {
            /* state file may not exist yet */
          }
        }
        if (!cancelled) setClock((c) => c + 1);
      })();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const coord = coordRef.current;
  const spinnerFrame = SPINNER_FRAMES[clock % SPINNER_FRAMES.length];
  const now = Date.now();
  const secsToNextPoll = nextPollAtRef.current
    ? Math.max(0, Math.ceil((nextPollAtRef.current - now) / 1000))
    : null;
  return (
    <Box flexDirection="column">
      <Static items={logs}>
        {(line) =>
          line.color ? (
            <Text key={line.id} color={line.color}>
              {line.text}
            </Text>
          ) : (
            <Text key={line.id}>{line.text}</Text>
          )
        }
      </Static>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {spinnerFrame}{" "}
          {pollStatus.state === "polling"
            ? `polling Linear (${pollStatus.filterDesc})`
            : pollStatus.lastAt !== null
              ? `last poll: ${pollStatus.lastFound} open, ${pollStatus.lastAdded} new${
                  secsToNextPoll !== null ? ` · next in ${secsToNextPoll}s` : ""
                }`
              : "starting…"}
        </Text>
        <Text dimColor>
          {"  "}workers active: {coord?.activeCount ?? 0} · queued: {coord?.queuedCount ?? 0}
        </Text>
        {coord?.activeWorkers.map((w) => {
          const meta = workerMetaRef.current.get(w.changeName);
          const elapsed = meta ? fmtElapsed(now - meta.startedAt) : "–";
          const iter = meta?.iter ?? 0;
          return (
            <Text key={w.changeName} color="cyan">
              {"  "}
              {spinnerFrame} {w.issueIdentifier} ({w.changeName}) · iter {iter} · {elapsed}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
