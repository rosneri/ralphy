import { log } from "@ralphy/output";
import type { Engine, Mode } from "@ralphy/types";

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
  // agent mode
  linearTeam: string;
  linearAssignee: string;
  linearStatus: string[];
  linearLabel: string[];
  pollInterval: number;
  concurrency: number;
  worktree: boolean;
}

const VALID_MODES = new Set<string>(["task", "list", "status", "init", "agent"]);

const VALID_MODELS = new Set<string>(["haiku", "sonnet", "opus"]);

const HELP_TEXT = [
  "Usage: ralph <command> [options]",
  "",
  "Commands:",
  "  task                    Run or resume a task",
  "  list                    List active changes",
  "  status                  Show detailed change status",
  "  init                    Initialize OpenSpec in current directory",
  "  agent                   Poll Linear for new tasks and run loops concurrently",
  "",
  "Options:",
  "  --name <name>           Change name (required for most commands)",
  "  --prompt <text>         Task description",
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
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "",
  "Agent mode options (require LINEAR_API_KEY env var):",
  "  --linear-team <key>     Linear team key (e.g. ENG)",
  "  --linear-assignee <id>  Filter by assignee (user id, email, or 'me')",
  "  --linear-status <name>  Filter by status name (repeatable, e.g. Todo, In Progress)",
  "  --linear-label <name>   Filter by label name (repeatable, any-of)",
  "  --poll-interval <s>     Seconds between Linear polls (default: 60)",
  "  --concurrency <n>       Max concurrent task loops (default: 1)",
  "  --worktree              Run each task in its own git worktree (.ralph/worktrees/<name>)",
  "",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  '  ralph task --name my-feature --prompt "Add dark mode"',
  "  ralph task --name my-feature --claude sonnet --max-iterations 10",
  "  ralph task --name my-feature",
  "  ralph list",
  "  ralph status --name my-feature",
  "  ralph init",
].join("\n");

export function printHelp(): void {
  log(HELP_TEXT);
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
    linearTeam: "",
    linearAssignee: "",
    linearStatus: [],
    linearLabel: [],
    pollInterval: 60,
    concurrency: 1,
    worktree: false,
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
  let expectTimeout = false;
  let expectPushInterval = false;
  let expectLinearTeam = false;
  let expectLinearAssignee = false;
  let expectLinearStatus = false;
  let expectLinearLabel = false;
  let expectPollInterval = false;
  let expectConcurrency = false;

  for (const arg of argv) {
    // Check if we're expecting a model argument after --claude
    if (expectModel) {
      if (VALID_MODELS.has(arg)) {
        result.model = arg;
        expectModel = false;
        continue;
      }
      // Not a valid model — fall through to process as a regular arg
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
    if (expectTimeout) {
      // Deprecated — consume and ignore
      expectTimeout = false;
      continue;
    }
    if (expectPushInterval) {
      // Deprecated — consume and ignore
      expectPushInterval = false;
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
    if (expectLinearStatus) {
      result.linearStatus.push(arg);
      expectLinearStatus = false;
      continue;
    }
    if (expectLinearLabel) {
      result.linearLabel.push(arg);
      expectLinearLabel = false;
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
      case "--timeout":
        expectTimeout = true;
        break;
      case "--push-interval":
        expectPushInterval = true;
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
      case "--linear-status":
        expectLinearStatus = true;
        break;
      case "--linear-label":
        expectLinearLabel = true;
        break;
      case "--poll-interval":
        expectPollInterval = true;
        break;
      case "--concurrency":
        expectConcurrency = true;
        break;
      case "--worktree":
        result.worktree = true;
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
