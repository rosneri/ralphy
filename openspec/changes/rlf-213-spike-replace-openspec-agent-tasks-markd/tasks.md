# Tasks for RLF-213

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-213/spike-replace-openspecagent-tasks-markdown-mechanism-with-beads-bd-as and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Setup

- [x] Install `bd` (beads CLI) and record the install method + version + binary footprint in `design.md`
- [x] Initialize a throwaway `.beads/` for the spike and confirm JSONL is git-tracked while the local DB is gitignored

## Backend evaluation

- [x] In `spike/beads/`, create a change modeled as a `bd` epic with ≥3 task children and ≥1 `blocks` dependency
- [x] Confirm `bd ready --json --limit 1` returns the same next task `firstUnchecked` would pick from the equivalent `tasks.md`; record the comparison
- [x] Add a high-priority flow bead that `blocks` a mission task and confirm it preempts mission work in `bd ready --json`
- [x] Verify "blocked but not done" is distinguishable from "all complete" (open-children count vs. empty `bd ready`)
- [x] Test two concurrent worktrees sharing one main-repo `.beads/`: both read ready work, one runs `bd claim`, confirm no double-claim / no JSONL corruption; paste commands + output into `design.md`

## Prototype BeadsChangeStore (read-path)

- [x] Implement a throwaway prototype `BeadsChangeStore` satisfying `readTaskList` / `getStatus` / `validateChange` from the `ChangeStore` interface, rendering `bd` state into the markdown shape `buildTaskPrompt` expects
- [x] Write a unit test proving selection parity with `firstUnchecked` on a fixture bd state (per the spec scenarios); patch `Bun.spawnSync` for `bd` invocations rather than mocking `node:child_process`
- [x] Confirm the prototype is NOT registered as the default store and does not modify `loop.ts` / `tasks-md.ts` / the flow machine

## Mapping & decision record

- [x] Complete the primitive→`bd` mapping table in `design.md`, flagging every gap with no clean equivalent
- [x] Resolve all five open questions in `design.md` (adapter-vs-native, OpenSpec spec artifacts, Linear sync, flow/preemption, binary dependency)
- [x] Write the go/no-go recommendation; if go, outline a follow-up implementation ticket

## Verification

- [x] Run `bun run lint` and fix any findings
- [x] Run `bun run test` and confirm green without lowering the coverage threshold
- [x] Run `bunx openspec validate rlf-213-spike-replace-openspec-agent-tasks-markd` and fix any errors
