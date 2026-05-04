import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ParsedArgs } from "../cli";
import { fetchOpenIssues, type LinearIssue } from "../agent/linear";
import { readAgentState, writeAgentState, type AgentState } from "../agent/state";
import { scaffoldChangeForIssue } from "../agent/scaffold";
import { ensureRalphyConfig, loadRalphyConfig, type RalphyConfig } from "../agent/config";

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

interface Worker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  proc: ReturnType<typeof Bun.spawn>;
  startedAt: number;
}

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `${Date.now()}-${lineCounter}`;
}

export function AgentMode({ args, projectRoot, statesDir, tasksDir }: AgentModeProps) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [workersTick, setWorkersTick] = useState(0);
  const workersRef = useRef<Worker[]>([]);
  const pendingRef = useRef(0);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<LinearIssue[]>([]);
  const stoppedRef = useRef(false);
  const stateRef = useRef<AgentState | null>(null);
  const configRef = useRef<RalphyConfig | null>(null);

  function log(text: string, color?: string) {
    setLogs((prev) => [...prev, { id: nextId(), text, color }]);
  }

  function spawnNext() {
    const cfg = configRef.current;
    const state = stateRef.current;
    if (!cfg || !state || stoppedRef.current) return;

    const concurrency = args.concurrency || cfg.concurrency;

    while (
      workersRef.current.length + pendingRef.current < concurrency &&
      queueRef.current.length > 0
    ) {
      const issue = queueRef.current.shift()!;
      pendingRef.current += 1;
      pendingIdsRef.current.add(issue.id);
      void launchWorker(issue);
    }
  }

  async function launchWorker(issue: LinearIssue) {
    let changeName: string;
    try {
      changeName = await scaffoldChangeForIssue(tasksDir, statesDir, issue);
    } catch (err) {
      pendingRef.current -= 1;
      pendingIdsRef.current.delete(issue.id);
      log(`! scaffold failed for ${issue.identifier}: ${(err as Error).message}`, "red");
      spawnNext();
      return;
    }

    const cfg = configRef.current!;
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

    log(`▶ ${issue.identifier} → ${changeName} (worker started)`, "cyan");

    const proc = Bun.spawn({
      cmd,
      cwd: projectRoot,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });

    const worker: Worker = {
      changeName,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      proc,
      startedAt: Date.now(),
    };
    workersRef.current.push(worker);
    pendingRef.current -= 1;
    pendingIdsRef.current.delete(issue.id);
    setWorkersTick((t) => t + 1);

    void proc.exited.then((code) => {
      const idx = workersRef.current.indexOf(worker);
      if (idx >= 0) workersRef.current.splice(idx, 1);
      const ok = code === 0;
      log(
        `${ok ? "✓" : "✗"} ${issue.identifier} → ${changeName} exited (code ${code})`,
        ok ? "green" : "red",
      );
      if (ok && stateRef.current) {
        if (!stateRef.current.processedIssueIds.includes(issue.id)) {
          stateRef.current.processedIssueIds.push(issue.id);
          void writeAgentState(projectRoot, stateRef.current);
        }
      }
      setWorkersTick((t) => t + 1);
      spawnNext();
    });
  }

  async function pollOnce() {
    const cfg = configRef.current!;
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      log("! LINEAR_API_KEY not set — cannot poll Linear", "red");
      stoppedRef.current = true;
      exit();
      return;
    }

    const filter = {
      team: args.linearTeam || cfg.linear.team,
      assignee: args.linearAssignee || cfg.linear.assignee,
      statuses: args.linearStatus.length ? args.linearStatus : cfg.linear.statuses,
      label: args.linearLabel || cfg.linear.label,
    };

    log(
      `… polling Linear (team=${filter.team ?? "*"}, assignee=${filter.assignee ?? "*"}, statuses=${
        filter.statuses?.length ? filter.statuses.join(",") : "open"
      }${filter.label ? `, label=${filter.label}` : ""})`,
    );

    let issues: LinearIssue[];
    try {
      issues = await fetchOpenIssues(apiKey, filter);
    } catch (err) {
      log(`! Linear poll failed: ${(err as Error).message}`, "red");
      return;
    }

    const state = stateRef.current!;
    const seen = new Set(state.processedIssueIds);
    const queued = new Set(queueRef.current.map((i) => i.id));
    const active = new Set(workersRef.current.map((w) => w.issueId));

    let added = 0;
    for (const issue of issues) {
      if (seen.has(issue.id)) continue;
      if (queued.has(issue.id)) continue;
      if (active.has(issue.id)) continue;
      if (pendingIdsRef.current.has(issue.id)) continue;
      queueRef.current.push(issue);
      added += 1;
    }

    state.lastPollAt = new Date().toISOString();
    await writeAgentState(projectRoot, state);

    log(`  found ${issues.length} open, ${added} new (queue=${queueRef.current.length})`);
    spawnNext();
  }

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      const cfgPath = await ensureRalphyConfig(projectRoot);
      configRef.current = await loadRalphyConfig(projectRoot);
      stateRef.current = await readAgentState(projectRoot);
      log(`agent mode — config: ${cfgPath}`, "gray");
      log(
        `concurrency=${args.concurrency || configRef.current.concurrency} pollInterval=${
          args.pollInterval || configRef.current.pollIntervalSeconds
        }s`,
        "gray",
      );

      const tick = async () => {
        if (stoppedRef.current) return;
        await pollOnce();
        if (stoppedRef.current) return;
        const interval =
          (args.pollInterval || configRef.current!.pollIntervalSeconds) * 1000;
        pollTimer = setTimeout(tick, interval);
      };
      void tick();
    }

    void init();

    const onSig = () => {
      stoppedRef.current = true;
      log("stopping agent — sending SIGTERM to workers", "yellow");
      for (const w of workersRef.current) {
        try {
          w.proc.kill();
        } catch {
          /* ignore */
        }
      }
      if (pollTimer) clearTimeout(pollTimer);
      exit();
    };
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);

    return () => {
      stoppedRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
    };
  }, []);

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
          workers active: {workersRef.current.length} · queued: {queueRef.current.length} · tick:{" "}
          {workersTick}
        </Text>
        {workersRef.current.map((w) => (
          <Text key={w.changeName} color="cyan">
            {"  "}● {w.issueIdentifier} ({w.changeName})
          </Text>
        ))}
      </Box>
    </Box>
  );
}
