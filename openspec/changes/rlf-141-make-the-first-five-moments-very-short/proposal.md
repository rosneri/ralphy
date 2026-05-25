# RLF-141: Make the first five Moments very short

Source: [RLF-141](https://linear.app/neriros/issue/RLF-141/make-the-first-five-moments-very-short)
Status: In Progress
Labels: Feature

## Why

New users of the Ralph loop framework encounter a steep learning curve when the agent jumps into large, verbose iterations immediately. The first five moments (loop iterations) should be very small so the user can quickly get used to the game before the agent picks up full steam.

Auto verbosity automatically adjusts Claude's response length based on the iteration count: the first 5 moments get a "VERY SHORT" instruction injected into the prompt, guiding the agent to take one small step at a time during the warm-up phase.

## What Changes

- `buildTaskPrompt` in `packages/core/src/loop.ts` prepends a verbosity guidance block to the prompt when `state.iteration < 5`.
- The block tells Claude to keep the response very short and take one small step only.
- No new config keys, CLI flags, or state fields are introduced — the feature is purely prompt-level.
- Unit tests added to `packages/core/src/__tests__/loop.test.ts` covering all boundary conditions (moments 1, 5, and 6).

## Acceptance Criteria

- Prompt for iterations 0–4 starts with a "Verbosity: VERY SHORT (Moment N/5)" block.
- Prompt for iteration 5 and beyond contains no verbosity block.
- Verbosity block appears before any steering content or task section.
- All existing and new tests pass (`bun run test`).
- Lint passes (`bun run lint`).

## Steering

_Add steering notes here as the loop runs._
