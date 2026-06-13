/**
 * Terse, always-on restatement of the project's non-negotiable engineering
 * rules, injected into every phase prompt so the agent self-enforces them
 * instead of relying on after-the-fact guardrails to reject the work.
 *
 * Single-sourced here on purpose: do NOT re-export this constant from a barrel
 * (that would violate the no-re-export rule it encodes). Import it from this
 * module path directly.
 */
export const PROJECT_QUALITY_RULES: string = [
  "- Use Bun-native APIs (`Bun.spawn`, `Bun.file`, `Bun.write`, …); never use `node:fs` sync APIs in source",
  "- No `any` and no unsafe casts — keep types honest",
  "- Spell names out; do not abbreviate identifiers",
  "- XState machines are the sole authority for stop/flow logic — never duplicate those guards imperatively",
  "- No re-exports (barrels); import from the defining module path",
  "- One config pipeline: read `resolveConfig` output; never write `args.x || cfg.y` merge logic in app code",
  "- Shared logic lives in `packages/` and is consumed by `apps/`",
].join("\n");

/**
 * Named failure classes the agent must actively audit its own diff against
 * during self-review — the recurring ways changes in this codebase go wrong.
 * Single-sourced here alongside {@link PROJECT_QUALITY_RULES}; do NOT re-export
 * from a barrel. Import from this module path directly.
 */
export const SELF_REVIEW_FAILURE_CLASSES: string = [
  "- **God-files**: a single file accreting unrelated responsibilities instead of being split",
  "- **Duplication**: copy-pasted prose or logic that should read from one source",
  "- **Dead code**: unreferenced exports, functions, or branches left behind",
  "- **Leaky boundaries**: `packages/` reaching into `apps/`, or internals crossing module lines",
  "- **Sentinel config merges**: `args.x || cfg.y` / `args.x !== <default>` logic instead of reading `resolveConfig` output",
  "- **`node:fs` sync APIs**: synchronous filesystem calls in source instead of Bun-native async APIs",
  "- **Imperative machine guards**: stop/flow logic duplicated by hand instead of delegated to the XState machines",
].join("\n");
