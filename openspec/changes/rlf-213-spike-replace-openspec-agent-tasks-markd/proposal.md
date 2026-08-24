# RLF-213: Spike: Replace OpenSpec/agent-tasks markdown mechanism with beads (bd) as task backend

Source: [RLF-213](https://linear.app/neriros/issue/RLF-213/spike-replace-openspecagent-tasks-markdown-mechanism-with-beads-bd-as)
Status: In Progress

## Why

Ralphy's task layer is markdown checkboxes parsed with regex. It has no real
dependency graph, recomputes "ready work" by re-parsing on every iteration,
encodes preemption as "prepend a section to `agent-tasks.md`", and is fragile
enough that an entire module (`normalizeNewlyAppendedSection`) exists only to
undo workers clobbering the file. Task state is smeared across `tasks.md`,
`agent-tasks.md`, `.ralph-state.json`, Linear, and the XState flow snapshot.

[beads](https://github.com/steveyegge/beads) (`bd`) is a dependency-aware,
JSON-first issue tracker built as agent memory: `bd ready --json` returns only
unblocked open work priority-sorted, `bd claim` is race-safe, `bd close
--reason` preserves context, and one shared `.beads/` across git worktrees fits
Ralphy's worktree-per-change model. **This is a spike**: its purpose is to
de-risk that swap by prototyping a `BeadsChangeStore` behind the existing
`ChangeStore` seam and producing a go/no-go recommendation — not to ship the
replacement.

## Context

Ralphy currently tracks two parallel streams of work as **markdown checklists** inside `openspec/changes/<change>/`:

- `tasks.md` — user-facing mission tasks (planning phase output)
- `agent-tasks.md` — system-generated flow tasks (CI fixes, conflicts, review follow-ups), which preempt mission tasks

The loop selects work by string-parsing markdown checkboxes (`packages/core/src/tasks-md.ts`: `firstUnchecked`, `countUnchecked`, `allCompleted`, `pickActiveTasksFile`, `prependFixTask`, `bothFilesCompleted`). Cross-task ordering/blocking lives partly in Linear (`issue.blockedByIds`, `orderIssuesHierarchically`) and partly in the markdown file order. Completion = a worker editing `- [ ]` → `- [x]`.

**Problems with the markdown approach:**

- No real dependency graph — ordering is implicit in file order + ad-hoc Linear topo sort.
- "Ready work" must be recomputed by parsing; preemption is encoded as "prepend to agent-tasks.md".
- Fragile: workers can pre-check, re-order, or clobber sections (`normalizeNewlyAppendedSection` exists purely to undo this).
- Task state is split across `tasks.md`, `agent-tasks.md`, `.ralph-state.json`, Linear, and the XState flow snapshot.

## Idea: use beads (`bd`) as the structured task backend

[beads](https://github.com/steveyegge/beads) is a dependency-aware issue tracker (CLI `bd`) purpose-built as agent memory. Relevant capabilities:

- **Issue graph** with `blocks` / `parent-child` / `related` / `discovered-from` dep types.
- `bd ready --json` returns only unblocked, open work, priority-sorted — replaces `firstUnchecked` + manual topo sort.
- `bd claim` = atomic claim (race-safe for parallel workers).
- `bd close --reason` = completion + preserved context (replaces checkbox flip).
- **Storage**: local DB (gitignored) + git-tracked JSONL, daemon auto-syncs; **all git worktrees share one** `.beads/` **in the main repo** — fits Ralphy's worktree-per-change model.
- JSON output on every command → no prose parsing.

### Proposed mapping

| Ralphy concept                                         | beads representation                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Mission task (`tasks.md` item)                         | `bd` issue, `type=task`, parented to a change epic                                       |
| Change / proposal                                      | `bd` issue `type=epic` (or `molecule`)                                                   |
| Flow task (`agent-tasks.md`: CI fix, conflict, review) | `bd` issue, high priority, `blocks` the mission work → naturally preempts via `bd ready` |
| Task ordering                                          | `bd dep add` (`blocks`) instead of file order                                            |
| `firstUnchecked` / `pickActiveTasksFile`               | `bd ready --json --limit 1`                                                              |
| `allCompleted` / `bothFilesCompleted`                  | epic has no open children / `bd ready` empty                                             |
| Completion (`- [x]`)                                   | `bd close <id> --reason`                                                                 |
| `prependFixTask`                                       | `bd create ... -p 0` + `bd dep add`                                                      |

### Architecture leverage point

Ralphy already abstracts task storage behind the `ChangeStore` **interface** (`packages/change-store/src/index.ts`), implemented today by `OpenSpecChangeStore` (`packages/openspec/src/openspec-change-store.ts`). A `BeadsChangeStore` implementing the same interface (`readTaskList`/`writeTaskList`/`validateChange`/`getStatus`) is the cleanest seam — the loop, prompt-builder, and flow machine need not change if the adapter translates bd state ↔ the markdown the prompt expects (or we update `buildTaskPrompt` to consume `bd ready` directly).

## Open questions / decisions

1. **Adapter vs. rip-and-replace** — implement `BeadsChangeStore` behind `ChangeStore` (low-risk, preserves prompt format) vs. teach `loop.ts`/`buildTaskPrompt` to consume `bd ready --json` natively.
2. **OpenSpec proposal/design/spec artifacts** — beads does NOT replace these ([proposal.md/design.md/specs/](http://proposal.md/design.md/specs/)). Scope this spike to **tasks only**; OpenSpec stays for the spec-authoring phases. Phase derivation (`deriveOpenSpecPhase`) still needs proposal/design stubs.
3. **Linear relationship** — does bd become the source of truth for sub-task ordering while Linear stays the human-facing issue layer? Or do we sync bd ↔ Linear? beads has built-in Linear sync worth evaluating.
4. **Flow/preemption** — model CI-fix/conflict/review as high-priority blocking beads, or keep the XState flow machine and only swap the checklist layer?
5. **Dependency** — adds a `bd` binary requirement (Go static binary; brew/npm install). Acceptable for Ralphy's install footprint?

## Suggested next steps (spike)

1. Install `bd`, prototype a change as an epic + task children with deps; confirm `bd ready --json` gives the ordering Ralphy wants.
2. Validate the shared-`.beads/`-across-worktrees model with two concurrent worktrees.
3. Implement a minimal `BeadsChangeStore` behind `ChangeStore`; run the existing loop against it on one change.
4. Decide on adapter-vs-native and Linear sync based on prototype findings.

## Key files

- `packages/change-store/src/index.ts` — `ChangeStore` interface (the seam)
- `packages/openspec/src/openspec-change-store.ts` — reference implementation to mirror
- `packages/core/src/tasks-md.ts` — markdown parsing this would replace
- `packages/core/src/loop.ts` — `buildTaskPrompt`, task selection
- `packages/core/src/openspec/phase.ts` — phase derivation (still needed for spec phases)
- `apps/agent/src/agent/post-task.ts` — `prependFixTask` (→ `bd create` + `bd dep add`)
- `apps/agent/src/queue/queue-order.ts` — `orderIssuesHierarchically` (overlaps with bd dep graph)

## What Changes

This is a **time-boxed spike**. It produces a throwaway-or-keep prototype plus a
written recommendation; it does **not** remove the markdown path or change the
default backend.

- Add a `spike/beads/` evaluation harness (scripts + notes) exercising `bd` as
  a task backend: create a change as an epic with task children, add `blocks`
  deps, and confirm `bd ready --json --limit 1` yields the ordering Ralphy's
  `firstUnchecked` + `pickActiveTasksFile` produce today.
- Verify the operational model: one shared `.beads/` in the main repo is
  readable/writable from two concurrent worktrees, and `bd claim` is race-safe
  for parallel workers.
- Prototype a minimal **read-path** `BeadsChangeStore` implementing the
  `ChangeStore` interface (`readTaskList`/`getStatus`/`validateChange` at
  minimum), translating `bd` issue state into the markdown shape
  `buildTaskPrompt` already consumes — so the existing loop runs unmodified.
- Map every markdown primitive in `packages/core/src/tasks-md.ts` and the
  `prependFixTask` flow to a concrete `bd` command, recording gaps where no
  clean equivalent exists.
- Produce a **decision record** in `design.md` answering the five open
  questions (adapter-vs-native, OpenSpec spec artifacts, Linear sync,
  flow/preemption modeling, the `bd` binary dependency) with a go/no-go
  recommendation and, if go, a follow-up implementation ticket outline.

Explicit non-goals: no removal of `tasks-md.ts`, no default-backend switch, no
production wiring of `BeadsChangeStore` into the live loop, no Linear↔bd sync
implementation.

## Acceptance Criteria

- [ ] A reproducible `spike/beads/` harness creates a change-as-epic with ≥3
      task children and ≥1 `blocks` dependency, and `bd ready --json --limit 1`
      returns the same single next task that `firstUnchecked` would pick from
      the equivalent `tasks.md`.
- [ ] A high-priority "flow" bead that `blocks` mission work demonstrably
      preempts it in `bd ready --json` output — the bd equivalent of
      `agent-tasks.md` jumping the queue.
- [ ] Two concurrent worktrees sharing one main-repo `.beads/` can both read
      ready work and `bd claim` without corrupting state; documented with the
      exact commands and observed output.
- [ ] A prototype `BeadsChangeStore` (read-path) satisfies `readTaskList` /
      `getStatus` / `validateChange` against the same `ChangeStore` interface,
      with the existing loop able to select and complete one task end-to-end on
      a throwaway change.
- [ ] A mapping table in `design.md` covers every `tasks-md.ts` primitive and
      `prependFixTask`, with each gap explicitly flagged.
- [ ] A go/no-go recommendation in `design.md` resolves all five open questions
      and, if go, links a follow-up implementation ticket outline.
- [ ] `bun run lint` and `bun run test` pass; `bunx openspec validate
    rlf-213-spike-replace-openspec-agent-tasks-markd` passes.

## Linear comments

**Neriya Rosner** — 2026-06-03T20:21:38.928Z
🤖 Ralph started working on this issue. Tracking change: `rlf-213-spike-replace-openspec-agent-tasks-markd`

## Additional instructions

You are working on RLF-213: Spike: Replace OpenSpec/agent-tasks markdown mechanism with beads (bd) as task backend.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
