# Design for RLF-213 — Beads (`bd`) task-backend spike

This is a **de-risking spike**. The design below describes the prototype to
build and the questions it must answer, not a production rollout. Anything in
`spike/beads/` is allowed to be throwaway.

## Goal

Prove (or disprove) that beads can replace the markdown task layer behind the
existing `ChangeStore` seam without touching the loop, prompt-builder, or flow
machine — and capture a go/no-go decision with evidence.

## The seam we exploit

Ralphy already routes all task I/O through the `ChangeStore` interface
(`packages/change-store/src/index.ts`), implemented today only by
`OpenSpecChangeStore` (`packages/openspec/src/openspec-change-store.ts`). The
loop reads tasks via `readTaskList` and never touches markdown files directly
for selection. That means a second implementation that returns the _same
markdown shape_ `buildTaskPrompt` expects can be dropped in behind the
interface with zero loop changes.

Today's task selection lives in `packages/core/src/tasks-md.ts` and is pure
string parsing. The spike's job is to show each of those primitives has a clean
`bd` equivalent.

## Files to touch (spike scope)

| Path                                                         | Change                                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spike/beads/` (new, throwaway)                              | Shell/TS harness: `bd` setup, epic+children creation, dep wiring, ready-ordering assertions, two-worktree concurrency check. Self-contained; not wired into the app.                                 |
| `packages/openspec/src/__tests__/` or a sibling `spike` test | Prototype `BeadsChangeStore` read-path + a unit test proving `readTaskList`/`getStatus`/`validateChange` parity on a fixture DB. Keep behind the spike; do **not** register it as the default store. |
| `openspec/changes/.../design.md` (this file)                 | Decision record: mapping table, two-worktree findings, go/no-go on the five open questions.                                                                                                          |

Explicitly **not** touched: `packages/core/src/loop.ts`, `tasks-md.ts`,
`apps/agent/src/agent/post-task.ts`, the flow machine, or the default store
wiring. If the spike concludes "go", those become a separate implementation
ticket.

## Primitive → `bd` command mapping (to verify, not assume)

| `tasks-md.ts` primitive                  | Purpose                     | Candidate `bd` equivalent                                | Risk to confirm                                                    |
| ---------------------------------------- | --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `firstUnchecked` / `pickActiveTasksFile` | next task, flow-first       | `bd ready --json --limit 1` (priority-sorted)            | Does priority + `blocks` reproduce the flow-preempts-mission rule? |
| `countUnchecked`                         | remaining work              | `bd list --status open --json` count under the epic      | Scoping to one change/epic                                         |
| `allCompleted` / `bothFilesCompleted`    | done?                       | epic has no open children / `bd ready` empty for epic    | Distinguishing "blocked" from "done"                               |
| `prependFixTask`                         | inject preempting flow task | `bd create … -p 0` + `bd dep add <fix> blocks <mission>` | Atomicity; passing the failure-output body                         |
| `normalizeNewlyAppendedSection`          | undo worker clobbering      | **obsolete** — bd state isn't a file workers edit        | Confirms a class of bug disappears                                 |
| `appendSteering` (tasks mirror)          | steering → task             | `bd create … --parent <epic>`                            | Keep steering prose in OpenSpec; mirror headline as a bead         |

A gap in any row that has no clean equivalent is a spike finding, recorded here.

## Data flow (prototype read-path)

```
loop.ts → ChangeStore.readTaskList(name)
            └─ BeadsChangeStore:
                 bd ready --json (scoped to change epic)
                 → render as the `## …` / `- [ ] …` markdown buildTaskPrompt expects
                 → loop selects, worker completes
            └─ completion path (future): bd close <id> --reason
```

For the spike, the write/completion path may be stubbed or driven manually via
`bd close`; the read-path parity is the primary deliverable.

## Operational model to validate

- **Shared `.beads/`**: all worktrees point at the main repo's `.beads/`. Verify
  two concurrent worktrees both see ready work and that `bd claim` is race-safe
  (no double-claim, no JSONL corruption). Record exact commands + output.
- **Storage**: local DB gitignored, JSONL git-tracked, daemon auto-syncs.
  Confirm the JSONL is the durable source and survives a fresh clone.
- **Binary dependency**: `bd` is a Go static binary (brew/npm/go install).
  Document install footprint and whether a preflight check (like the Bun
  preflight) is warranted.

## Edge cases / risks

- **Empty `bd ready` but work remains** — everything blocked. Must not be
  mistaken for "change complete". Distinguish via open-children count on the
  epic, not just `ready` emptiness.
- **Flow vs. mission preemption** — must reproduce today's invariant that flow
  tasks always run first. Modeled as priority `-p 0` + `blocks`; verify a
  mission task is genuinely withheld from `ready` while a flow bead is open.
- **Worktree teardown** — Ralphy removes worktrees; the shared `.beads/` must
  live in the main repo so state outlives any single worktree.
- **OpenSpec coexistence** — `proposal.md`/`design.md`/`specs/` and phase
  derivation (`deriveOpenSpecPhase`) still need the OpenSpec change dir to
  exist. Spike scopes bd to **tasks only**; spec artifacts stay in OpenSpec.
- **Migration of in-flight changes** — a switch would need to import existing
  `tasks.md` checkboxes into beads. Out of spike scope; note the cost.
- **JSONL commit discipline** — Ralphy forbids `git add -A` / `git commit -am`
  and stages files individually. `bd`'s daemon auto-syncs the DB to git-tracked
  JSONL out-of-band, so the JSONL can change without the worker's knowledge.
  The spike must determine who commits `.beads/*.jsonl` and when (worker vs.
  daemon vs. an explicit `bd export` + staged commit), so task-state mutations
  land in the same commits Ralphy already makes — otherwise state drifts between
  the DB and what git records. Record the chosen commit hook in the decision.

## Spike findings (filled as the spike runs)

### Setup: install method, version, footprint

- **Install method:** `brew install beads` (Homebrew formula `beads`). No
  `@beads/cli` npm package exists under that name (npm 404), so the npm-install
  path assumed in the proposal does not hold for this version. Also available
  via `go install`.
- **Version:** `bd version` → `1.0.5 (Homebrew)`.
- **Binary:** `/opt/homebrew/bin/bd` → `…/Cellar/beads/1.0.5/bin/beads`,
  Mach-O 64-bit arm64.
- **Footprint — bigger than assumed.** beads is **not** a single self-contained
  static Go binary. The Homebrew formula pulls in **`dolt` (~110 MB)** — a
  Git-for-data SQL database — plus `icu4c`, for a combined install of
  **~250 MB+** (`beads` 127 MB + `dolt` 110 MB + ICU). bd uses dolt as its
  storage/versioning engine, which is what gives it the git-tracked, mergeable
  data model — but it means adopting beads adds a heavyweight transitive
  dependency, not a lightweight binary. **This directly informs open question
  #5:** the install footprint is material and a preflight check (mirroring the
  Bun preflight) plus a documented install story would be required if we go.

### Init model: Dolt-backed, not "DB + JSONL", and invasive

`bd init` (1.0.5) does **not** create the lightweight "gitignored SQLite DB +
git-tracked JSONL" the proposal assumed. It provisions an **embedded Dolt**
store at `.beads/embeddeddolt/` (Dolt = Git-for-data SQL), which `.beads/.gitignore`
**ignores**. The durable task graph lives in Dolt, versioned by Dolt's own
mechanism — not as a single committed JSONL the way the proposal pictured.
Implications for open question #2/#5 and the JSONL-commit-discipline edge case:
the "git-tracked JSONL" sync story must be re-examined against the Dolt model
(there is an `interactions.jsonl`, but it is not the task graph).

`bd init` is also **invasive**: in one shot it writes/overwrites `AGENTS.md`,
`CLAUDE.md` (with beads integration text), `.claude/settings.json` (registers a
SessionStart hook), `.codex/`, a `.agents/skills/beads/` skill, and git hooks
into `.beads/hooks/`. For Ralphy — which already owns `CLAUDE.md`, `.claude/`,
and its own hooks — a raw `bd init` would clobber project files. Any adoption
must drive bd with a scoped, non-interactive init (or hand-author `.beads/`)
rather than the default wizard.

### Backend evaluation: `bd ready` reproduces the selection rules

Throwaway harness in `/tmp/bd-spike` (git repo, `bd init`), epic `Change: demo`
with children Task A/B/C wired via `bd dep add <child> <epic> -t parent-child`,
and `bd dep add B A -t blocks` (A precedes B). Observed:

- **Ordering / `firstUnchecked` parity** — `bd ready --json` returned Task A and
  Task C (priority-sorted) but **withheld Task B** (blocked by A), matching what
  `firstUnchecked` picks from the equivalent `tasks.md`. ✅
- **Flow preemption / `prependFixTask` parity** — created a flow bead
  `bd create "FLOW: fix CI" -t task -p 0` and `bd dep add A FLOW -t blocks`.
  `bd ready` then put **`FLOW: fix CI` first** (p0) and withheld Task A. This is
  the bd equivalent of `agent-tasks.md` jumping the queue — priority + `blocks`
  reproduces flow-preempts-mission. ✅
- **`allCompleted` parity (native!)** — `bd close <epic>` is **refused** while
  children are open: `cannot close epic … 1 open child issue(s); close children
first or use --force`. The epic-open-children guard _is_ `allCompleted` /
  `bothFilesCompleted`, enforced by bd rather than by re-parsing markdown. ✅
- **blocked-but-not-done vs done** — after closing A, B became ready; an open
  epic with open children is distinguishable from "done" via
  `bd list --status open` count, independent of whether `bd ready` is momentarily
  empty. ✅
- **Epic-in-ready wart + scoping** — `bd ready` returns the **epic itself** as
  ready work (parent-child does not exclude the parent). Both the wart and
  change-scoping are solved by flags: `bd ready --parent <epic>
--exclude-type=epic --limit 1` is the precise `firstUnchecked` +
  `pickActiveTasksFile` equivalent. A `BeadsChangeStore` would always pass these.
- **Linear-sync nag** — nearly every command prints `⚠ Linear data has never
been pulled — run 'bd linear sync --pull'` to **stderr/stdout**, so the JSON
  parser must read `--json` cleanly (the warning is not inside the JSON, but it
  is noisy). Relevant to open question #3: bd actively expects a Linear sync.

**Net:** every `tasks-md.ts` selection primitive has a confirmed clean `bd`
equivalent (`bd ready --parent <epic> --exclude-type=epic --limit 1` for
selection, the epic-children guard for completion, priority+`blocks` for
preemption). The open risks are now operational (Dolt footprint, invasive init,
JSONL/commit story, Linear-sync expectation), not "can the graph express it".

## Open questions → decision record

Each must be answered in this section before the spike closes (go/no-go):

1. **Adapter vs. rip-and-replace** — recommendation: _TBD from prototype_.
2. **OpenSpec spec artifacts** — bd does not replace proposal/design/specs;
   scope bd to tasks. _Confirm._
3. **Linear relationship** — bd as sub-task source of truth vs. bd↔Linear sync.
   Evaluate bd's built-in Linear sync. _TBD._
4. **Flow/preemption modeling** — blocking beads vs. keep XState flow machine +
   swap only the checklist layer. _TBD._
5. **`bd` binary dependency** — acceptable for Ralphy's install footprint?
   _TBD; recommend preflight if go._

**Recommendation:** _filled in at spike end — go/no-go + follow-up ticket
outline if go._
