import { log } from "@ralphy/output";
import type { Engine, Indicators, Marker, Mode, SetIndicator, GetIndicator } from "@ralphy/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Injected at build time by apps/cli/build.ts via Bun.build define.
// Falls back to a runtime walk when executing from source (e.g. bun run src/index.ts).
declare const RALPH_VERSION: string | undefined;

function getVersion(): string {
  // Compile-time constant takes precedence (set by build.ts).
  try {
    if (typeof RALPH_VERSION !== "undefined" && RALPH_VERSION) return RALPH_VERSION;
  } catch {
    // not defined in this context
  }

  // Walk up from current directory or import.meta.dir to find workspace root (has "workspaces" field)
  const dirsToTry: string[] = [];
  try {
    dirsToTry.push(import.meta.dir);
  } catch {
    // import.meta.dir might not be available
  }
  dirsToTry.push(process.cwd());

  for (const startDir of dirsToTry) {
    let current = startDir;
    for (let i = 0; i < 10; i++) {
      const pkgPath = resolve(current, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces && pkg.version && pkg.version !== "0.0.0") {
          return pkg.version;
        }
      } catch {
        // File doesn't exist or isn't valid JSON, keep walking up
      }
      const parent = resolve(current, "..");
      if (parent === current) break;
      current = parent;
    }
  }

  return "unknown";
}

export const VERSION: string = getVersion();

export interface ParsedArgs {
  mode: Mode;
  name: string;
  prompt: string;
  engine: Engine;
  model: string;
  engineSet: boolean;
  maxIterations: number;
  maxCostUsd: number;
  maxRuntimeMinutes: number;
  maxConsecutiveFailures: number;
  delay: number;
  log: boolean;
  verbose: boolean;
  manualTest: boolean;
  fromAgent: boolean;
  // agent mode
  linearTeam: string;
  linearAssignee: string;
  pollInterval: number;
  concurrency: number;
  worktree: boolean;
  /** CLI overrides for the indicator map. Wire layer merges these onto
   *  the config's `linear.indicators`; CLI wins on conflict. */
  indicators: Partial<Indicators>;
  createPr: boolean;
  fixCi: boolean;
  /** Agent mode: stop picking up new issues after this many have been started (0 = unlimited). */
  maxTickets: number;
  /** Agent mode: emit JSONL to stdout instead of rendering the Ink dashboard. */
  jsonOutput: boolean;
  /** Debug mode: override the project root directory (default: cwd walk). */
  projectRoot?: string | undefined;
}

const VALID_MODES = new Set<string>(["task", "list", "status", "init", "agent", "clean", "debug"]);

const VALID_MODELS = new Set<string>(["haiku", "sonnet", "opus"]);

const INDICATOR_KEYS = new Set<keyof Indicators>([
  "getTodo",
  "getInProgress",
  "getConflicted",
  "getReview",
  "setInProgress",
  "setDone",
  "setError",
  "setConflicted",
  "clearConflicted",
  "clearReview",
]);
const GET_KEYS = new Set<keyof Indicators>([
  "getTodo",
  "getInProgress",
  "getConflicted",
  "getReview",
]);

const HELP_TEXT = [
  `ralph v${VERSION}`,
  "",
  "Usage: ralph <command> [options]",
  "",
  "Commands:",
  "  task                    Run or resume a task",
  "  list                    List active changes",
  "  status                  Show detailed change status",
  "  init                    Initialize OpenSpec in current directory",
  "  agent                   Poll Linear for new tasks and run loops concurrently",
  "  clean                   Remove worktree, branch, openspec change, and task state for --name",
  "  debug                   Show agent log timeline, Linear state, and GitHub PR for --name",
  "",
  "Options:",
  "  --name <name>           Change name (required for most commands)",
  "  --prompt <text>         Task description (in agent mode: appended to every scaffolded proposal)",
  "  --prompt-file <path>    Read prompt from file",
  "  --model <model>         Set model (haiku|sonnet|opus)",
  "  --claude [model]        Use Claude engine (haiku|sonnet|opus, default: opus)",
  "  --codex                 Use Codex engine",
  "  --delay <seconds>       Seconds between iterations",
  "  --max-iterations <n>    Stop after N iterations (0 = unlimited)",
  "  --max-cost <n>          Stop when total cost exceeds $N (0 = no limit)",
  "  --max-runtime <n>       Stop after N minutes of wall-clock time (0 = no limit)",
  "  --max-failures <n>      Stop after N consecutive failures (default: 5, 0 = disable)",
  "  --unlimited             No iteration limit (default)",
  "  --manual-test           Enable manual testing phase (create test tasks in tasks.md)",
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "",
  "Agent mode options (require LINEAR_API_KEY env var):",
  "  --linear-team <key>     Linear team key (e.g. ENG)",
  "  --linear-assignee <id>  Filter by assignee (user id, email, or 'me')",
  "  --poll-interval <s>     Seconds between Linear polls (default: 60)",
  "  --concurrency <n>       Max concurrent task loops (default: 1)",
  "  --worktree              Run each task in its own git worktree",
  "  --indicator <k>:<t>:<v> Override an indicator (repeatable). Examples:",
  "                          --indicator getTodo:status:Todo",
  "                          --indicator setDone:label:shipped",
  "                          --indicator setDone:status:Done   (combined with above → multi-marker)",
  "                          Keys: getTodo, getInProgress, getConflicted, getReview,",
  "                                setInProgress, setDone, setError, setConflicted,",
  "                                clearConflicted, clearReview",
  "                          Types: label, status",
  "  --create-pr             Push the worker branch and open a GitHub PR on success (needs --worktree)",
  "  --fix-ci                After opening the PR, re-run on CI failures until green (needs --create-pr)",
  "  --max-tickets <n>       Stop picking up new issues after N have been started (0 = unlimited)",
  "  --json-output           Emit JSONL to stdout instead of the Ink dashboard (for scripting/CI)",
  "",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  '  ralph task --name my-feature --prompt "Add dark mode"',
  "  ralph task --name my-feature --claude sonnet --max-iterations 10",
  "  ralph agent --indicator getTodo:status:Todo --indicator setDone:status:Done",
  "  ralph list",
  "  ralph status --name my-feature",
  "  ralph init",
].join("\n");

export function printHelp(): void {
  log(HELP_TEXT);
}

/**
 * Parse one --indicator value of the form `key:type:value` into a typed
 * pair. `value` may itself contain colons; we split only on the first two.
 */
function parseIndicatorArg(raw: string): { key: keyof Indicators; marker: Marker } {
  const firstColon = raw.indexOf(":");
  if (firstColon < 0) {
    const err = new Error("--indicator expects key:type:value") as Error & { input?: string };
    err.input = raw;
    throw err;
  }
  const secondColon = raw.indexOf(":", firstColon + 1);
  if (secondColon < 0) {
    const err = new Error("--indicator expects key:type:value") as Error & { input?: string };
    err.input = raw;
    throw err;
  }
  const key = raw.slice(0, firstColon) as keyof Indicators;
  const type = raw.slice(firstColon + 1, secondColon) as Marker["type"];
  const value = raw.slice(secondColon + 1);
  if (!INDICATOR_KEYS.has(key)) {
    const err = new Error("unknown indicator key") as Error & { key?: string };
    err.key = key;
    throw err;
  }
  if (type !== "label" && type !== "status") {
    const err = new Error("indicator type must be 'label' or 'status'") as Error & {
      type?: string;
    };
    err.type = type;
    throw err;
  }
  if (!value) throw new Error("indicator value cannot be empty");
  return { key, marker: { type, value } };
}

/** Merge a marker into the existing indicators bag for the given key. */
function mergeIndicator(bag: Partial<Indicators>, key: keyof Indicators, marker: Marker): void {
  if (GET_KEYS.has(key)) {
    const existing = bag[key] as GetIndicator | undefined;
    const filter = existing ? [...existing.filter, marker] : [marker];
    (bag as Record<string, GetIndicator>)[key] = { filter };
  } else {
    const existing = bag[key] as SetIndicator | undefined;
    let next: SetIndicator;
    if (!existing) next = marker;
    else if ("apply" in existing) next = { apply: [...existing.apply, marker] };
    else next = { apply: [existing, marker] };
    (bag as Record<string, SetIndicator>)[key] = next;
  }
}

export async function parseArgs(argv: string[]): Promise<ParsedArgs> {
  const result: ParsedArgs = {
    mode: "task",
    name: "",
    prompt: "",
    engine: "claude",
    model: "opus",
    engineSet: false,
    maxIterations: 0,
    maxCostUsd: 0,
    maxRuntimeMinutes: 0,
    maxConsecutiveFailures: 5,
    delay: 0,
    log: false,
    verbose: false,
    manualTest: false,
    fromAgent: false,
    linearTeam: "",
    linearAssignee: "",
    pollInterval: 60,
    concurrency: 1,
    worktree: false,
    indicators: {},
    createPr: false,
    fixCi: false,
    maxTickets: 0,
    projectRoot: undefined,
    jsonOutput: false,
  };

  let expectModel = false;
  let expectModelFlag = false;
  let expectName = false;
  let expectPrompt = false;
  let expectPromptFile = false;
  let expectDelay = false;
  let expectMaxCost = false;
  let expectMaxRuntime = false;
  let expectMaxFailures = false;
  let expectMaxIterations = false;
  let expectLinearTeam = false;
  let expectLinearAssignee = false;
  let expectPollInterval = false;
  let expectConcurrency = false;
  let expectMaxTickets = false;
  let expectIndicator = false;
  let expectProjectRoot = false;

  for (const arg of argv) {
    if (expectModel) {
      if (VALID_MODELS.has(arg)) {
        result.model = arg;
        expectModel = false;
        continue;
      }
      expectModel = false;
    }

    if (expectModelFlag) {
      if (!VALID_MODELS.has(arg)) {
        throw new Error("Invalid model");
      }
      result.model = arg;
      expectModelFlag = false;
      continue;
    }
    if (expectName) {
      result.name = arg;
      expectName = false;
      continue;
    }
    if (expectPrompt) {
      result.prompt = arg;
      expectPrompt = false;
      continue;
    }
    if (expectPromptFile) {
      result.prompt = await Bun.file(arg).text();
      expectPromptFile = false;
      continue;
    }
    if (expectDelay) {
      result.delay = parseInt(arg, 10);
      expectDelay = false;
      continue;
    }
    if (expectMaxCost) {
      result.maxCostUsd = parseFloat(arg);
      expectMaxCost = false;
      continue;
    }
    if (expectMaxRuntime) {
      result.maxRuntimeMinutes = parseFloat(arg);
      expectMaxRuntime = false;
      continue;
    }
    if (expectMaxFailures) {
      result.maxConsecutiveFailures = parseInt(arg, 10);
      expectMaxFailures = false;
      continue;
    }
    if (expectMaxIterations) {
      result.maxIterations = parseInt(arg, 10);
      expectMaxIterations = false;
      continue;
    }
    if (expectLinearTeam) {
      result.linearTeam = arg;
      expectLinearTeam = false;
      continue;
    }
    if (expectLinearAssignee) {
      result.linearAssignee = arg;
      expectLinearAssignee = false;
      continue;
    }
    if (expectPollInterval) {
      result.pollInterval = parseInt(arg, 10);
      expectPollInterval = false;
      continue;
    }
    if (expectConcurrency) {
      result.concurrency = parseInt(arg, 10);
      expectConcurrency = false;
      continue;
    }
    if (expectMaxTickets) {
      result.maxTickets = parseInt(arg, 10);
      expectMaxTickets = false;
      continue;
    }
    if (expectIndicator) {
      const { key, marker } = parseIndicatorArg(arg);
      mergeIndicator(result.indicators, key, marker);
      expectIndicator = false;
      continue;
    }
    if (expectProjectRoot) {
      result.projectRoot = arg;
      expectProjectRoot = false;
      continue;
    }

    switch (arg) {
      case "--claude":
        if (result.engineSet && result.engine !== "claude") {
          throw new Error("Choose only one engine flag: --claude or --codex");
        }
        result.engine = "claude";
        result.engineSet = true;
        expectModel = true;
        break;
      case "--codex":
        if (result.engineSet && result.engine !== "codex") {
          throw new Error("Choose only one engine flag: --claude or --codex");
        }
        result.engine = "codex";
        result.engineSet = true;
        break;
      case "--model":
        expectModelFlag = true;
        break;
      case "--name":
        expectName = true;
        break;
      case "--prompt":
        expectPrompt = true;
        break;
      case "--prompt-file":
        expectPromptFile = true;
        break;
      case "--delay":
        expectDelay = true;
        break;
      case "--max-cost":
        expectMaxCost = true;
        break;
      case "--max-runtime":
        expectMaxRuntime = true;
        break;
      case "--max-failures":
        expectMaxFailures = true;
        break;
      case "--max-iterations":
        expectMaxIterations = true;
        break;
      case "--unlimited":
        result.maxIterations = 0;
        break;
      case "--log":
        result.log = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;
      case "--linear-team":
        expectLinearTeam = true;
        break;
      case "--linear-assignee":
        expectLinearAssignee = true;
        break;
      case "--poll-interval":
        expectPollInterval = true;
        break;
      case "--concurrency":
        expectConcurrency = true;
        break;
      case "--max-tickets":
        expectMaxTickets = true;
        break;
      case "--worktree":
        result.worktree = true;
        break;
      case "--indicator":
        expectIndicator = true;
        break;
      case "--create-pr":
        result.createPr = true;
        break;
      case "--fix-ci":
        result.fixCi = true;
        break;
      case "--json-output":
        result.jsonOutput = true;
        break;
      case "--manual-test":
        result.manualTest = true;
        break;
      case "--from-agent":
        result.fromAgent = true;
        break;
      case "--project-root":
        expectProjectRoot = true;
        break;
      default:
        if (VALID_MODES.has(arg)) {
          result.mode = arg as Mode;
        } else {
          throw new Error("Unknown argument. Run 'ralph --help' for usage information.");
        }
        break;
    }
  }

  return result;
}
