import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ParsedArgs } from "../cli";
import {
  fetchOpenIssues,
  addIssueComment,
  fetchIssueComments,
  fetchWorkflowStates,
  updateIssueState,
  type LinearIssue,
} from "../agent/linear";
import { readAgentState, writeAgentState } from "../agent/state";
import { scaffoldChangeForIssue } from "../agent/scaffold";
import { ensureRalphyConfig, loadRalphyConfig } from "../agent/config";
import { AgentCoordinator } from "../agent/coordinator";

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

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [, setTick] = useState(0);
  const coordRef = useRef<AgentCoordinator | null>(null);

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
      appendLog(`concurrency=${concurrency} pollInterval=${pollInterval}s`, "gray");

      const apiKey = process.env["LINEAR_API_KEY"];
      if (!apiKey) {
        appendLog("! LINEAR_API_KEY not set — cannot poll Linear", "red");
        exit();
        return;
      }

      const filter = {
        team: args.linearTeam || cfg.linear.team,
        assignee: args.linearAssignee || cfg.linear.assignee,
        statuses: args.linearStatus.length ? args.linearStatus : cfg.linear.statuses,
        labels: args.linearLabel.length ? args.linearLabel : cfg.linear.labels,
      };

      // Cache: teamKey -> Map<lowercased state name, state id>
      const stateCache = new Map<string, Map<string, string>>();
      const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

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
            return scaffoldChangeForIssue(tasksDir, statesDir, issue, comments);
          },
          spawnWorker: (changeName) => {
            const cmd: string[] = [
              process.execPath,
              process.argv[1] ?? "",
              "task",
              "--name",
              changeName,
              "--" + (args.engineSet ? args.engine : cfg.engine),
              args.engineSet ? args.model : cfg.model,
            ];
            const maxIter = args.maxIterations || cfg.maxIterationsPerTask;
            if (maxIter > 0) cmd.push("--max-iterations", String(maxIter));
            const maxCost = args.maxCostUsd || cfg.maxCostUsdPerTask;
            if (maxCost > 0) cmd.push("--max-cost", String(maxCost));

            const proc = Bun.spawn({
              cmd,
              cwd: projectRoot,
              stdout: "ignore",
              stderr: "ignore",
              stdin: "ignore",
            });
            return { exited: proc.exited, kill: () => proc.kill() };
          },
          loadState: () => readAgentState(projectRoot),
          saveState: (s) => writeAgentState(projectRoot, s),
          onLog: appendLog,
          onWorkersChanged: () => setTick((t) => t + 1),
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
          },
        },
        {
          concurrency,
          filter,
          inProgressStatus: cfg.linear.inProgressStatus,
          doneStatus: cfg.linear.doneStatus,
          postComments: cfg.linear.postComments,
        },
      );
      coordRef.current = coord;
      await coord.init();

      const tick = async () => {
        if (cancelled) return;
        const filterDesc = `team=${filter.team ?? "*"}, assignee=${filter.assignee ?? "*"}, statuses=${
          filter.statuses?.length ? filter.statuses.join(",") : "open"
        }${filter.labels?.length ? `, labels=${filter.labels.join(",")}` : ""}`;
        appendLog(`… polling Linear (${filterDesc})`);
        const { found, added } = await coord.pollOnce();
        appendLog(`  found ${found} open, ${added} new (queue=${coord.queuedCount})`);
        if (cancelled) return;
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

  const coord = coordRef.current;
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
          workers active: {coord?.activeCount ?? 0} · queued: {coord?.queuedCount ?? 0}
        </Text>
        {coord?.activeWorkers.map((w) => (
          <Text key={w.changeName} color="cyan">
            {"  "}● {w.issueIdentifier} ({w.changeName})
          </Text>
        ))}
      </Box>
    </Box>
  );
}
