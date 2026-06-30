import { buildWorkflowMarkdown, indicatorsForPreset } from "@ralphy/workflow/wizard";
import { applyAssigneeOverride } from "@ralphy/workflow";
import type {
  IndicatorMap,
  IndicatorMarker,
  LinearFilterValue,
  SetupMode,
  WizardAnswers,
  WizardValue,
} from "@ralphy/workflow/wizard-types";
import {
  LINEAR_ASSIGNEE_CHOICE_FIELD_ID,
  LINEAR_ASSIGNEE_VALUE_FIELD_ID,
  PROMPT_BODY_FIELD_ID,
  REPO_LINK_FIELD_ID,
} from "@ralphy/workflow/fields/field-identifiers";
import { REPO_ANSWER_IDS, type Answers } from "./options";

/** Wrap collected answers into the builder's input shape. */
export function assembleAnswers(mode: SetupMode, values: Answers): WizardAnswers {
  return { mode, values };
}

/** Convert the indicators answer (preset string or custom map) to a map. */
function resolveIndicators(value: WizardValue | undefined): IndicatorMap | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return value === "none"
      ? undefined
      : indicatorsForPreset(value as "status-standard" | "label-standard");
  }
  return value as IndicatorMap;
}

export function buildFromAnswers(
  mode: SetupMode,
  answers: Answers,
  build: (answers: WizardAnswers, bodyOverride?: string) => string = buildWorkflowMarkdown,
): string {
  const values: Answers = { ...answers };
  // Concurrency > 1 requires isolated worktrees so parallel tasks don't share
  // (and clobber) one working copy. Force it on — the wizard hides the worktree
  // toggle once concurrency > 1, and the runtime enforces the same invariant.
  const concurrencyValue = values["concurrency"];
  if (typeof concurrencyValue === "number" && concurrencyValue > 1) {
    values["useWorktree"] = true;
  }
  // Compose the assignee select (+ optional specific-user value) into the
  // `linear.filter` marker list. The choice/value are control fields, never
  // written as frontmatter keys. Any existing `label` clauses (advanced,
  // config-file-only) are preserved — only the `assignee` clause is swapped.
  const assigneeChoice = values[LINEAR_ASSIGNEE_CHOICE_FIELD_ID];
  if (typeof assigneeChoice === "string") {
    let assignee: string | undefined;
    if (assigneeChoice === "other") {
      const raw = values[LINEAR_ASSIGNEE_VALUE_FIELD_ID];
      assignee = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    } else {
      assignee = assigneeChoice; // me / any / unassigned
    }
    const existing = Array.isArray(values["linear.filter"])
      ? (values["linear.filter"] as LinearFilterValue)
      : [];
    if (assignee) values["linear.filter"] = applyAssigneeOverride(existing, assignee);
    else if (existing.length > 0) values["linear.filter"] = existing;
  }
  delete values[LINEAR_ASSIGNEE_CHOICE_FIELD_ID];
  delete values[LINEAR_ASSIGNEE_VALUE_FIELD_ID];
  if ("linear.indicators" in values) {
    const indicators = resolveIndicators(values["linear.indicators"]);
    if (indicators) values["linear.indicators"] = indicators;
    else delete values["linear.indicators"];
  }
  // When the confirmation gate is on, ensure the indicators carry an approval
  // signal. Without `getApproved` a human can never clear the gate (only the
  // timeout can) — and the preset paths don't include it. Add a sensible
  // `approved`-label default unless the custom editor already supplied one.
  // Only augments an indicators map already being written, so diff-mode runs
  // that don't touch indicators are untouched.
  if (
    values["linear.confirmationMode.enabled"] === true &&
    values["linear.indicators"] &&
    typeof values["linear.indicators"] === "object"
  ) {
    const map = { ...(values["linear.indicators"] as IndicatorMap) };
    if (!("getApproved" in map)) {
      map.getApproved = { filter: [{ type: "label", value: "approved" }] };
      map.clearApproved = { type: "label", value: "approved" };
      values["linear.indicators"] = map;
    }
  }
  // Park-status pollability: the awaiting-confirmation park marker is now set in
  // the Linear lifecycle indicators (`setAwaitingConfirmation`), not as a
  // separate question. When the gate is on and that marker is a status, the
  // parked ticket's worker is killed and re-discovered only through the
  // in-progress poll — so the park status MUST also be a `getInProgress` pickup
  // filter or the `approved` label is never seen. Wire it in automatically. Only
  // augments an indicators map already being written.
  if (
    values["linear.confirmationMode.enabled"] === true &&
    values["linear.indicators"] &&
    typeof values["linear.indicators"] === "object"
  ) {
    const map: IndicatorMap = { ...(values["linear.indicators"] as IndicatorMap) };
    const awaiting = map.setAwaitingConfirmation;
    const parkMarker = Array.isArray(awaiting)
      ? awaiting.find((marker) => marker.type === "status")
      : awaiting;
    if (
      parkMarker &&
      !Array.isArray(parkMarker) &&
      "type" in parkMarker &&
      parkMarker.type === "status"
    ) {
      const existing = map.getInProgress;
      const filter: IndicatorMarker[] =
        existing && !Array.isArray(existing) && "filter" in existing ? [...existing.filter] : [];
      if (!filter.some((marker) => marker.type === "status" && marker.value === parkMarker.value)) {
        filter.push({ type: "status", value: parkMarker.value });
        map.getInProgress = { filter };
        values["linear.indicators"] = map;
      }
    }
  }
  // GitHub Issues settings are only meaningful when GitHub is the tracker. If
  // the user explored the GitHub branch and then switched back to Linear, the
  // `github.issues.*` answers linger in the map but their questions are gated
  // out — drop them so a Linear file never carries stray github keys.
  if (values["tracker.kind"] !== "github") {
    for (const id of Object.keys(values)) {
      if (id.startsWith("github.issues.")) delete values[id];
    }
  }
  // `repo.link` is a control answer, not a frontmatter key. When confirmed, the
  // injected `repo.*` identity is written; when declined (or never shown), the
  // identity is dropped so no `repo` block is emitted. Either way the control
  // answer itself is removed so it never lands in the file.
  const linkRepo = values[REPO_LINK_FIELD_ID] === true;
  delete values[REPO_LINK_FIELD_ID];
  if (!linkRepo) {
    for (const id of REPO_ANSWER_IDS) delete values[id];
  }
  // The prompt body is not a frontmatter setting — pull it out and pass it as
  // the body override instead of writing it as a key.
  let bodyOverride: string | undefined;
  if (PROMPT_BODY_FIELD_ID in values) {
    const body = values[PROMPT_BODY_FIELD_ID];
    if (typeof body === "string") bodyOverride = body;
    delete values[PROMPT_BODY_FIELD_ID];
  }
  return build(assembleAnswers(mode, values), bodyOverride);
}
