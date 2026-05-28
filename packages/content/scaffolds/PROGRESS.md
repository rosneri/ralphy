# Progress — {{TASK_NAME}}

> Task: {{TASK_PROMPT}}
> Created: {{DATE}}

## Section 1 — <Title>

- [ ] impl: add `FieldName` to `TypeName` in `src/types/foo.ts`
- [ ] test: `TypeName` accepts `FieldName` and rejects missing value (`src/types/foo.test.ts`)
- [ ] impl: update `functionName` in `src/module/bar.ts` to pass `FieldName`
- [ ] test: `functionName` propagates `FieldName` to output (`src/module/bar.test.ts`)
- [ ] caller: update `callSite` in `src/other/baz.ts` — pass new `FieldName` arg

## Section N — Verification & Cleanup

- [ ] integration: run full flow end-to-end and confirm expected behavior
- [ ] lint: `bun run lint` — zero errors
- [ ] typecheck: `bun run typecheck` — zero errors
