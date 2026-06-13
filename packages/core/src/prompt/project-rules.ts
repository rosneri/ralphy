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
