import type { Engine } from "@ralphy/types";

/**
 * Terminal disposition a ticket reached, derived from the worker's effective
 * exit code by `dispositionFromExitCode`. Mirrors the post-task exit codes
 * (`apps/agent/src/agent/post-task.ts`).
 */
export type RetroDisposition = "done" | "no-changes" | "ci-failed" | "pr-failed" | "error";

/**
 * Everything `runRetrospective` needs to describe a finished ticket run. The
 * agent app builds this once per terminal worker exit. All `paths` entries are
 * absolute; any of them may be missing on disk (log disabled, no JSON log,
 * etc.) — the prompt instructs the agent to read what exists.
 */
export interface RetroContext {
  /** Ticket identifier (e.g. `RLF-212`), or the change name when no issue. */
  identifier: string;
  /** Change name — used for the log / state file slugs. */
  changeName: string;
  /** Working directory (worktree) the retrospective engine runs in. */
  cwd: string;
  /** Engine + model used to drive the retrospective pass. */
  engine: Engine;
  model: string;
  /** The worker's effective exit code; mapped to a `RetroDisposition`. */
  exitCode: number;
  /** PR URL when one was opened/surfaced, else null. */
  prUrl: string | null;
  /** Local date (`YYYY-MM-DD`) used for the output filename + dedupe key. */
  date: string;
  /** Best-effort ticket digest (title/description/comments) or a placeholder. */
  ticketDigest: string;
  /** Absolute paths of the run's data sources. Any may be absent on disk. */
  paths: {
    /** `openspec/changes/<changeName>/`. */
    changeDir: string;
    /** `<statesDir>/<changeName>/.ralph-state.json`. */
    stateFilePath: string;
    /** Per-change worker log, or null when logging is off. */
    logFile: string | null;
    /** `--json-log-file` JSONL stream, or null when not set. */
    jsonLogFile: string | null;
    /** Per-project `agent-state.json`, or null when unavailable. */
    agentStateFile: string | null;
  };
}

/** Subset of `@ralphy/engine`'s `RunEngineOptions` the retrospective needs. */
export interface RetroRunEngineOptions {
  engine: Engine;
  model: string;
  prompt: string;
  cwd: string;
  onOutput?: (line: string) => void;
}

/** Injected collaborators for `runRetrospective`. */
export interface RetroDeps {
  /** Engine driver — production passes `@ralphy/engine`'s `runEngine`. */
  runEngine: (opts: RetroRunEngineOptions) => Promise<{ exitCode: number }>;
  /** Logger; matches the agent app's `onLog` signature. */
  log: (text: string, color?: string) => void;
  /**
   * In-memory dedupe set, created once per agent run and closed over. Keyed
   * `${identifier}:${disposition}:${date}` so a resume that reaches the same
   * terminal disposition the same day does not regenerate an identical report.
   */
  seen: Set<string>;
}

/** Result of a retrospective attempt. Never thrown — always returned. */
export interface RetroResult {
  /** True when the report file was written and verified on disk. */
  written: boolean;
  /** Resolved absolute output path (present once resolved). */
  outputPath?: string;
  /** Set when skipped without running the engine. */
  skipped?: "duplicate";
  /** Disposition the run mapped to. */
  disposition?: RetroDisposition;
}
