import { log } from "@ralphy/output";
import { VERSION } from "@ralphy/version";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  type CommonArgs,
} from "@ralphy/cli-args";

export { VERSION };

export type LoopMode = "task" | "status" | "init" | "clean" | "debug";

export interface LoopParsedArgs extends CommonArgs {
  mode: LoopMode;
  name: string;
  prompt: string;
  manualTest: boolean;
  /** Set when spawned by the agent app — flips on PR creation for the task. */
  fromAgent: boolean;
}

// allow-duplicate
const VALID_MODES = new Set<string>(["task", "status", "init", "clean", "debug"]);

// allow-duplicate
const HELP_TEXT = [
  `ralphy loop v${VERSION}`,
  "",
  "Usage: ralphy loop <command> [options]",
  "",
  "Commands:",
  "  task                    Run or resume a task",
  "  status                  Show detailed change status",
  "  init                    Initialize OpenSpec in current directory",
  "  clean                   Remove worktree, branch, openspec change, and task state for --name",
  "  debug                   Show agent log timeline, Linear state, and GitHub PR for --name",
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
  "  --manual-test           Enable manual testing phase (create test tasks in tasks.md)",
  "  --log                   Log raw engine stream",
  "  --verbose               Verbose output",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  '  ralphy loop task --name my-feature --prompt "Add dark mode"',
  "  ralphy loop task --name my-feature --claude sonnet --max-iterations 10",
  "  ralphy loop status --name my-feature",
  "  ralphy loop init",
].join("\n");

export function printLoopHelp(): void {
  log(HELP_TEXT);
}

export async function parseLoopArgs(argv: string[]): Promise<LoopParsedArgs> {
  const common = initialCommonArgs();
  const result: LoopParsedArgs = {
    ...common,
    mode: "task",
    name: "",
    prompt: "",
    manualTest: false,
    fromAgent: false,
  };

  const state = emptyParseState();
  let expectName = false;
  let expectPrompt = false;
  let expectPromptFile = false;

  for (const arg of argv) {
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

    if (parseCommonArg(arg, result, state)) continue;

    switch (arg) {
      case "--name":
        expectName = true;
        break;
      case "--prompt":
        expectPrompt = true;
        break;
      case "--prompt-file":
        expectPromptFile = true;
        break;
      case "--manual-test":
        result.manualTest = true;
        break;
      case "--from-agent":
        result.fromAgent = true;
        break;
      default:
        if (VALID_MODES.has(arg)) {
          result.mode = arg as LoopMode;
        } else {
          throw new Error("Unknown argument. Run 'ralphy loop --help' for usage information.");
        }
        break;
    }
  }

  return result;
}
