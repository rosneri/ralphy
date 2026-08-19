/**
 * Narrow the free-string CLI override values back to the workflow schema's
 * literal unions. The parser already validated them against the schema enums,
 * so these only guard against a hand-constructed override object — an
 * unrecognised value falls back to the workflow value rather than poisoning
 * the effective config.
 */
import type { WorkflowConfig } from "@ralphy/workflow";

/**
 * Narrow a CLI model string (already validated by the parser against the
 * schema enum) back to the workflow's model type. Falls back to the workflow
 * value for anything unexpected so a hand-constructed override can never
 * poison the effective config.
 */
export function asWorkflowModel(
  value: string | undefined,
  fallback: WorkflowConfig["model"],
): WorkflowConfig["model"] {
  if (value === "fable" || value === "opus" || value === "sonnet" || value === "haiku") {
    return value;
  }
  return fallback;
}

/** Same narrowing for `--effort` (see `asWorkflowModel`). */
export function asWorkflowEffort(
  value: string | undefined,
  fallback: WorkflowConfig["effort"],
): WorkflowConfig["effort"] {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value;
  }
  return fallback;
}
