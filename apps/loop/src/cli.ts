import { log } from "@ralphy/output";
import { VERSION } from "@ralphy/version";
import {
  initialCommonArgs,
  parseCommonArg,
  emptyParseState,
  resolvePromptFile,
  resolveWorkflowFile,
  type CommonArgs,
} from "@ralphy/cli-args";

export { VERSION };

export type LoopMode = "task" | "status" | "init" | "clean" | "debug";

export interface ReviewPhaseArgs {
  enabled: boolean;
  maxRounds: number;
  reviewerModel?: string;
  reviewerContextStrategy: "fresh" | "warm";
}

export interface LoopParsedArgs extends CommonArgs {
  mode: LoopMode;
  manualTest: boolean;
  /** Review phase configuration forwarded from the workflow config. */
  reviewPhase: ReviewPhaseArgs;
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
  "  --workflow <path>       Path to an alternate WORKFLOW.md (default: <project>/WORKFLOW.md)",
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
  "  --review-enabled        Enable self-review pass after all tasks complete",
  "  --review-model <m>      Model for the review pass (haiku|sonnet|opus); implies --review-enabled",
  "  --review-max-rounds <n> Max review-fix rounds (default: 1)",
  "  --review-context-strategy <s>  fresh|warm (default: fresh)",
  "  --help, -h              Show this help message",
  "",
  "Examples:",
  '  ralphy loop task --name my-feature --prompt "Add dark mode"',
  "  ralphy loop task --name my-feature --claude sonnet --max-iterations 10",
  "  ralphy loop task --name my-feature --review-enabled --review-model haiku",
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
    manualTest: false,
    reviewPhase: {
      enabled: false,
      maxRounds: 1,
      reviewerContextStrategy: "fresh",
    },
  };

  const state = emptyParseState();
  let expectReviewModel = false;
  let expectReviewMaxRounds = false;
  let expectReviewContextStrategy = false;

  for (const arg of argv) {
    if (expectReviewModel) {
      result.reviewPhase.reviewerModel = arg;
      result.reviewPhase.enabled = true;
      expectReviewModel = false;
      continue;
    }
    if (expectReviewMaxRounds) {
      result.reviewPhase.maxRounds = parseInt(arg, 10);
      expectReviewMaxRounds = false;
      continue;
    }
    if (expectReviewContextStrategy) {
      if (arg !== "fresh" && arg !== "warm") {
        throw new Error('Invalid --review-context-strategy value. Must be "fresh" or "warm".');
      }
      result.reviewPhase.reviewerContextStrategy = arg;
      expectReviewContextStrategy = false;
      continue;
    }

    if (parseCommonArg(arg, result, state)) continue;

    switch (arg) {
      case "--manual-test":
        result.manualTest = true;
        break;
      case "--review-enabled":
        result.reviewPhase.enabled = true;
        break;
      case "--review-model":
        expectReviewModel = true;
        break;
      case "--review-max-rounds":
        expectReviewMaxRounds = true;
        break;
      case "--review-context-strategy":
        expectReviewContextStrategy = true;
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

  await resolvePromptFile(result, state);
  resolveWorkflowFile(result, state);

  return result;
}
