# Tasks for RLF-83

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-83/spec-pdf-attachment-renders-duplicated-content and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Remove the duplicate `## Description` block from `scaffoldChangeForIssue` in `apps/agent/src/agent/scaffold.ts` so the Linear issue description (and its placeholder fallback) is emitted only under `## Why`.
- [x] Add `pdf-parse` to `devDependencies` in the root `package.json` so the renderer regression test can decode PDF text under Bun.
- [x] Extend `apps/agent/src/__tests__/agent.test.ts` with a test asserting the issue description appears **exactly once** in the generated `proposal.md`, and a test asserting the scaffold does **not** emit a `## Description` header.
- [x] Extend `apps/agent/src/__tests__/render-pdf.test.ts` with a `pdf-parse`-backed test that renders a fixture markdown containing the sentinel `# UniqueRegressionHeading` heading and a sentinel paragraph, then asserts each sentinel string occurs exactly once in the decoded PDF text.
- [x] Run `bun run lint` and fix any reported issues.
- [x] Run `bun run test` and confirm all tests (including the new ones) pass.
- [x] Run `bunx openspec validate rlf-83-spec-pdf-attachment-renders-duplicated-c --strict` and confirm the proposal validates.
