## Guardrail: Ralph-loop self-enforcement — inject project rules every iteration, self-critique rubric, and run check:structure before check-off

**Why this is the highest-leverage guardrail:** Ralphy _builds itself_ via the loop, so the loop's prompts and in-loop gates are a first-class quality surface. Most project-rule violations the audit found (node:fs-sync, no-any, no-abbreviation, args.x||cfg.y config merges, machines-as-authority duplication, no-reexport) are produced by workers that never see those rules and are never checked against them inside the loop.

**Gaps (verified 2026-06-13):**

- `buildMetaPrompt` (`packages/core/src/prompt/meta-prompt.ts:64`) is the per-iteration injection point and injects **zero** project rules.
- The WORKFLOW.md `rules:` array (`WORKFLOW.md:27`, `:320`) only flows through the first-prompt template, **not** through `buildPhasePrompt`/`buildMetaPrompt`, which build _every_ iteration.
- The execute prompt only says "run `bun run lint` and `bun run test`" (`packages/core/src/loop.ts:43`); the in-loop validate gate runs only `test`/`lint`/`typecheck` — the 10 `check:structure` scripts are **never** run inside the loop, only in a human's pre-commit. A worker that opens a PR (the default) has its structural compliance checked nowhere until review.

## Plan (three sub-parts, can land separately)

1. **PROJECT_QUALITY_RULES preamble** injected by `buildMetaPrompt` into **every** iteration: a concise enumerated list — Bun-native only (no `node:fs` sync), no `any`, no name abbreviations, XState machines are the sole stop/flow authority (no imperative guard duplication), no re-exports, config via the single `resolveConfig` pipeline (no `args.x || cfg.y`). Source the text from one constant so it stays single-source.
2. **Self-critique pass** before a task is checked off: extend the review block (`loop.ts:256-281`, `buildReviewPrompt` `loop.ts:377-394`) to name the concrete failure classes to self-audit against (god-files, duplication, dead code, leaky boundaries, sentinel config merges, `node:fs`-sync) instead of a generic "audit against acceptance criteria."
3. **In-loop structural gate:** add `bun run check:structure` (and the new guardrail scripts) to the validate command set so the loop self-heals structural violations the same way it self-heals failing tests — before completing the task, not after a human review.

## Acceptance criteria

- [ ] Every iteration's prompt contains the project-rules preamble (assert via a unit test on `buildMetaPrompt`/`buildPhasePrompt` output).
- [ ] The review/self-critique prompt enumerates the specific failure classes.
- [ ] `check:structure` runs inside the loop's validate phase; a structural violation triggers a fix iteration.
- [ ] `bun run typecheck`, `bun test packages/core/src` pass; coverage not reduced.

## Verification

```bash
bun test packages/core/src/prompt          # asserts preamble + rubric present in built prompts
rg -n 'check:structure' packages/core/src   # validate phase now runs it
```

## Notes

- Add a small drift check (`scripts/check-prompt-rule-sync.ts`) asserting each rule keyword in the preamble also appears in CLAUDE.md or `.oxlintrc.json`, so the prompt can't rot out of sync with what's actually enforced.

**Enforcement:** in-loop (self-healing) + CI for the prompt unit tests. **Effort:** M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
