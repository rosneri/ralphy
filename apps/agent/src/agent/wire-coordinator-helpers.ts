import { join } from "node:path";
import type { Bus } from "@ralphy/events";
import type { Indicators } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";
import { projectLayout } from "@ralphy/core/layout";
import { createGhCliCodeHost } from "@ralphy/codehost";
import { changeNameForIssue } from "./scaffold";
import { AgentCoordinator } from "./coordinator";
import type { RalphyConfig } from "./config";
import { PollContext } from "../shared/capabilities/poll-context";
import type { FeatureCtx } from "../features/types";
import type { ConfirmationCaps } from "../features/confirmation";
import { processAwaitingForIssue } from "../features/confirmation/awaiting";

type AwaitingProcessDeps = Parameters<typeof processAwaitingForIssue>[1];

/**
 * Emit `agent.diag` events through the bus. The conditional shape preserves
 * `exactOptionalPropertyTypes`: omit `color` entirely when it is undefined
 * rather than emitting `color: undefined`.
 */
export type AgentDiagnostics = (area: string, message: string, color?: string) => void;

export function createAgentDiagnostics(bus: Bus): AgentDiagnostics {
  return (area, message, color) => {
    bus.emit(
      color !== undefined
        ? { type: "agent.diag", area, message, color }
        : { type: "agent.diag", area, message },
    );
  };
}

/**
 * Default `runScript` implementation used when the caller does not inject one.
 * Runs the command through `sh -c` with `WORKSPACE_ROOT` exported and logs a
 * yellow diagnostic on a non-zero exit.
 */
export function createDefaultScriptRunner(
  projectRoot: string,
  diag: AgentDiagnostics,
): (command: string, cwd: string) => Promise<number> {
  return async (command, cwd) => {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", command],
      cwd,
      env: { ...process.env, WORKSPACE_ROOT: projectRoot },
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      diag(
        "script",
        `! script exited code ${code}${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
        "yellow",
      );
    }
    return code;
  };
}

/**
 * Concurrency > 1 requires isolated worktrees: parallel workers must not share
 * one working copy or they clobber each other's files. Force it on (and warn)
 * rather than silently corrupting the tree. The init wizard enforces the same
 * invariant up front; this backstops a hand-edited WORKFLOW.md.
 */
export function resolveUseWorktreeForConcurrency(
  configuredUseWorktree: boolean,
  concurrency: number,
  diag: AgentDiagnostics,
): boolean {
  if (concurrency > 1 && !configuredUseWorktree) {
    diag(
      "config",
      `! concurrency is ${concurrency} but useWorktree is off — forcing worktrees on so parallel tasks get isolated working copies`,
      "yellow",
    );
    return true;
  }
  return configuredUseWorktree;
}

/**
 * Manual-merge fallback policy: merge through the CodeHost port, log and
 * continue on failure (the caller still advances the ticket to done).
 */
export function createManualMergeFallback(
  codeHost: ReturnType<typeof createGhCliCodeHost>,
  autoMergeStrategy: RalphyConfig["autoMergeStrategy"],
  diag: AgentDiagnostics,
): (prUrl: string) => Promise<boolean> {
  return async (prUrl) => {
    try {
      await codeHost.merge(prUrl, autoMergeStrategy);
      return true;
    } catch (err) {
      const e = err as Error & { stderr?: string };
      diag("pr", `! failed to merge ${prUrl}: ${e.stderr?.trim() || e.message}`, "yellow");
      return false;
    }
  };
}

/**
 * RLF-208: when a ticket is targeted but it matches none of the configured
 * get-indicator buckets, the loop will pick up nothing — surface that so the
 * operator isn't left wondering why the run is idle.
 */
export function warnWhenTargetedTicketsLackGetIndicator(
  ticketNumbers: number[],
  indicators: Indicators,
  diag: AgentDiagnostics,
): void {
  if (ticketNumbers.length === 0) return;
  const hasGetIndicator = [indicators.getTodo, indicators.getInProgress].some(
    (ind) => ind && ind.filter.length > 0,
  );
  if (!hasGetIndicator) {
    diag(
      "ticket",
      `! --ticket set (${ticketNumbers.join(", ")}) but no getTodo/getInProgress indicator is configured — nothing will be picked up`,
      "yellow",
    );
  }
}

/** Current loop iteration recorded in the change's `.ralph-state.json`. */
export async function readIterationCount(
  changeName: string,
  cwdByChange: Map<string, string>,
  projectRoot: string,
): Promise<number> {
  const root = cwdByChange.get(changeName) ?? projectRoot;
  const file = Bun.file(projectLayout(root).stateFile(changeName));
  if (!(await file.exists())) return 0;
  const json = (await file.json()) as { iteration?: number };
  return json.iteration ?? 0;
}

/** Fingerprint of the change's task documents, used to detect edits. */
export async function readTasksFingerprint(
  changeName: string,
  cwdByChange: Map<string, string>,
  projectRoot: string,
): Promise<string | null> {
  const root = cwdByChange.get(changeName) ?? projectRoot;
  const changeDir = projectLayout(root).changeDir(changeName);
  const parts: string[] = [];
  for (const name of ["tasks.md", "proposal.md", "design.md"]) {
    const file = Bun.file(join(changeDir, name));
    if (!(await file.exists())) continue;
    parts.push(`${name}:${file.lastModified}:${file.size}`);
  }
  return parts.length > 0 ? parts.join("|") : null;
}

/**
 * Build the confirmation feature capability. `detect` parks awaiting tickets by
 * delegating to `processAwaitingForIssue`; `reapForAwaiting` and `openDraftPr`
 * are read through the same late-bound coordinator reference the rest of the
 * wiring uses.
 */
export function createConfirmationCaps(params: {
  cfg: RalphyConfig;
  apiKey: string;
  projectRoot: string;
  useWorktree: boolean;
  indicators: Indicators;
  cwdByChange: Map<string, string>;
  awaitingChangeSet: Set<string>;
  coordRef: { current: AgentCoordinator | null };
  applyIndicator: AwaitingProcessDeps["applyIndicator"];
  applyMarker: AwaitingProcessDeps["applyMarker"];
  openDraftPr: NonNullable<AwaitingProcessDeps["openDraftPr"]>;
  onAwaitingTicket?: AwaitingProcessDeps["onAwaitingTicket"];
  onLog: AwaitingProcessDeps["onLog"];
}): ConfirmationCaps {
  const {
    cfg,
    apiKey,
    projectRoot,
    useWorktree,
    indicators,
    cwdByChange,
    awaitingChangeSet,
    coordRef,
    applyIndicator,
    applyMarker,
    openDraftPr,
    onAwaitingTicket,
    onLog,
  } = params;
  return {
    detect: (issue) =>
      processAwaitingForIssue(issue, {
        cfg,
        apiKey,
        projectRoot,
        useWorktree,
        indicators,
        cwdOf: (changeName) => cwdByChange.get(changeName),
        awaitingChangeSet,
        reapForAwaiting: (changeName) => coordRef.current?.reapForAwaiting(changeName),
        applyIndicator,
        applyMarker,
        // prDraft: open the draft PR at the design-ready/park point. See
        // createOpenDraftPr — reuses the idempotent createPullRequest and skips
        // the meta-only guard so a design-only PR isn't blocked.
        openDraftPr,
        ...(onAwaitingTicket ? { onAwaitingTicket } : {}),
        onLog,
      }),
    run: async () => {},
  };
}

/**
 * Build the per-issue `FeatureCtx`. `getPollContext` is read lazily so the
 * builder always observes the latest `PollContext` (reset on every `beforePoll`).
 */
export function createFeatureContextBuilder(params: {
  cwdByChange: Map<string, string>;
  projectRoot: string;
  bus: Bus;
  confirmationCaps: ConfirmationCaps;
  getPollContext: () => PollContext;
}): (issue: TrackedIssue) => FeatureCtx {
  const { cwdByChange, projectRoot, bus, confirmationCaps, getPollContext } = params;
  return (issue) => ({
    issue,
    worktree: cwdByChange.get(changeNameForIssue(issue)) ?? projectRoot,
    state: { writeField: async () => {} },
    bus,
    caps: {
      gh: null,
      linear: null,
      git: null,
      fsChange: null,
      worker: null,
      confirmation: confirmationCaps,
    },
    poll: getPollContext(),
    now: () => new Date(),
  });
}

/**
 * Assemble the `AgentCoordinator` options object (its second constructor
 * argument). Indicator setters and `maxTickets` are spread conditionally to
 * preserve exact optionality.
 */
export function buildCoordinatorOptions(params: {
  concurrency: number;
  indicators: Indicators;
  cfg: RalphyConfig;
  maxTickets: number;
  prRecoveryEnabled: boolean;
}): ConstructorParameters<typeof AgentCoordinator>[1] {
  const { concurrency, indicators, cfg, maxTickets, prRecoveryEnabled } = params;
  return {
    concurrency,
    ...(indicators.setInProgress !== undefined ? { setInProgress: indicators.setInProgress } : {}),
    ...(indicators.setDone !== undefined ? { setDone: indicators.setDone } : {}),
    ...(indicators.setError !== undefined ? { setError: indicators.setError } : {}),
    ...(indicators.getAutoMerge !== undefined ? { getAutoMerge: indicators.getAutoMerge } : {}),
    postComments: cfg.linear.postComments,
    commentEveryIterations: cfg.linear.updateEveryIterations,
    ...(maxTickets > 0 ? { maxTickets } : {}),
    createsPrs: cfg.createPrOnSuccess,
    prRecovery: {
      enabled: prRecoveryEnabled,
      fixCi: cfg.prRecovery.fixCi,
      fixConflicts: cfg.prRecovery.fixConflicts,
      maxRecoverySessions: cfg.prRecovery.maxRecoverySessions,
    },
  };
}
