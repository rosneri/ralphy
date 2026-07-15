# Ralphy — an idea file

_An [idea file](https://x.com/karpathy/status/2040470801506541998) in the Karpathy sense: this describes the concept, not the code. Hand it to your coding agent and it can build a version of this tailored to your stack, your issue tracker, and your conventions. The implementation in this repo is one instantiation; the idea below is the shareable unit._

## The idea

A coding agent working on a large task in one long session degrades: context fills up, it loses the plot, it starts undoing its own work. The fix is the **Ralph loop**: instead of one long-lived agent, run a _fresh_ agent per iteration against durable state on disk. The state — not the agent's memory — is the source of truth.

Concretely:

1. A change is described as a small bundle of markdown files: a proposal (what and why), a design (how), and a **task checklist** (`tasks.md`) that decomposes the work into small, independently verifiable items.
2. A loop spawns a fresh agent with a prompt that says: read the change files, do the **first unchecked task**, validate it (build, tests, lint), and check it off. Nothing else.
3. The agent exits. The loop inspects the outcome, updates loop state (iteration count, cost, failure history), and spawns the next fresh agent.
4. Repeat until the checklist is done or a stop condition fires.

Each iteration starts with a clean context window and full knowledge of where things stand, because "where things stand" lives in files, not in a conversation.

## What makes it work

- **The checklist is the program.** The agent is a dumb interpreter that executes one instruction per invocation. Task granularity is the main quality lever: tasks should be completable and verifiable in a single agent run.
- **Validation before check-off.** An item is only checked off after project validation passes. Protect the validation scripts themselves from agent edits — the agent must not be able to redefine success.
- **Hard stop conditions, owned by a state machine, not scattered ifs:** max iterations, max cost, max wall-clock runtime, and max _consecutive identical failures_ (the loop-of-death detector). Unlimited iterations against a paid API is a footgun; make caps first-class.
- **Explicit lifecycle states.** A change isn't just running/done — it moves through states like working, fixing merge conflicts, fixing CI, awaiting human input, in review, done, error. Model this as an explicit state machine and send typed events; don't infer state from log strings.
- **Human steering as data.** Humans steer by appending to a steering section of the proposal or editing the checklist between iterations — they edit the state, not the conversation.

## Natural extensions

- **Issue-tracker integration**: source changes from tracker issues (Linear, GitHub Issues, Jira); post plans, progress, and questions back as comments; let "awaiting human" map to a tracker status.
- **Agent adapters**: the loop shouldn't care which CLI agent runs an iteration (Claude Code, Codex, etc.) — wrap each in an adapter with a common spawn/result interface.
- **Parallel workers**: run many changes concurrently, one worktree per change, with a coordinator that owns spawning and reaping.
- **A dashboard**: the durable on-disk state makes a live UI nearly free — render the state files.

## What to ask your agent for

"Build me a Ralph loop for my project: changes as proposal/design/tasks markdown bundles, a runner that spawns a fresh <your agent CLI> per iteration to do exactly one task and validate it, stop conditions for iterations/cost/runtime/repeated failures, and loop state persisted as JSON. Integrate with <your tracker> for intake and status."
