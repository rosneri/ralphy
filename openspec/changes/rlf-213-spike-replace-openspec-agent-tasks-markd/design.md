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

## Primitive → `bd` command mapping (verified against the spike harness)

Verdict legend: **✅ clean** = a direct `bd` equivalent confirmed by the spike;
**⚠ gap** = an equivalent exists but with an operational caveat that the
adapter must handle; **— n/a** = the primitive becomes obsolete.

| `tasks-md.ts` primitive                  | Purpose                     | Verified `bd` equivalent                                                       | Verdict                                                                                                                         |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `firstUnchecked` / `pickActiveTasksFile` | next task, flow-first       | `bd ready --parent <epic> --exclude-type=epic --limit 1 --json`                | ✅ clean — priority-sort + `blocks` reproduce flow-first selection (unit test `beads-change-store.spike.test.ts` proves parity) |
| `countUnchecked`                         | remaining work              | `bd list --status open --parent <epic> --exclude-type=epic --json` count       | ✅ clean — `--parent` scopes to one change                                                                                      |
| `allCompleted` / `bothFilesCompleted`    | done?                       | open-children count == 0 (NOT `bd ready` emptiness); epic-close guard enforces | ⚠ gap — must use the retried open-children count, never `ready` emptiness (lock-drop / all-blocked ambiguity)                   |
| `prependFixTask`                         | inject preempting flow task | `bd create … -p 0` + `bd dep add <mission> <fix> -t blocks`                    | ⚠ gap — two non-atomic calls; if the `dep add` fails mid-way the fix is ready but does not yet preempt. Wrap + verify.          |
| `normalizeNewlyAppendedSection`          | undo worker clobbering      | **obsolete** — task state is a DB graph, not a file workers can rewrite        | — n/a — an entire class of clobber-repair bug disappears (a point in bd's favour)                                               |
| `appendSteering` (tasks mirror)          | steering → task             | `bd create … --parent <epic>` for the headline; prose stays in `proposal.md`   | ⚠ gap — steering is free prose; only a derived headline maps to a bead. Prose home stays OpenSpec (open question #2).           |

**Flagged gaps (no fully clean equivalent):**

1. **Completion detection is not "ready is empty".** Under the embedded-Dolt
   single-writer lock an empty `bd ready` is ambiguous (all-blocked, _or_ this
   process lost the lock race and got silent empty output). The adapter must
   decide "done" only from a _retried_ open-children count. Implemented in the
   prototype's `getStatus` (`isComplete = openChildren.length === 0`).
2. **`prependFixTask` is two writes, not one.** `bd create` then `bd dep add`
   are separate transactions; there is no single atomic "create-blocking-task"
   command in 1.0.5. The flow-injection path must create-then-link-then-verify
   (re-read `bd ready` to confirm the fix now precedes mission work) and treat a
   half-applied state as a retry, not success.
3. **Write/JSONL commit discipline has no drop-in equivalent.** Markdown
   completion is a file edit that lands in the worker's own commit. `bd close`
   mutates the Dolt store out-of-band; Ralphy's "stage files individually, never
   `git add -A`" rule means the adapter must own an explicit `bd export` +
   staged commit of `.beads/*.jsonl` (or accept the gitignored Dolt store as the
   only durable copy — see open question #2). This is the largest gap.
4. **Steering prose has no bead representation.** Only a headline can become a
   bead; the prose body has to stay in `proposal.md`. Mixed-home for steering.

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
- **Storage**: _assumption (DB gitignored, JSONL git-tracked, daemon syncs)
  did not hold for 1.0.5 — see Spike findings: the store is embedded Dolt and
  gitignored. Re-confirm the durable/clone-survival story against Dolt._
- **Binary dependency**: _assumption ("Go static binary") did not hold — see
  Spike findings: beads pulls in dolt + icu4c (~250 MB+). A preflight check
  (like the Bun preflight) is warranted if we go._

## Edge cases / risks

- **Empty `bd ready` but work remains** — two distinct causes, both fatal if
  read as "change complete": (1) everything is blocked on open deps, and
  (2) **lock contention** — this `bd` process lost the embedded-Dolt single-
  writer race and returned empty silently (see the concurrency finding). Both
  are distinguished via a retried open-children count on the epic
  (`bd list --status open --parent <epic>`), never via `ready` emptiness alone.
- **Flow vs. mission preemption** — must reproduce today's invariant that flow
  tasks always run first. Modeled as priority `-p 0` + `blocks`; verify a
  mission task is genuinely withheld from `ready` while a flow bead is open.
- **Worktree teardown** — Ralphy removes worktrees; the shared `.beads/` must
  live in the main repo so state outlives any single worktree. _Confirmed:_ a
  worktree resolves to main's `embeddeddolt/` via the git common dir with zero
  extra wiring, so state already lives in the right place (see concurrency
  finding). `bd -C <main>`/`--db` is the explicit fallback.
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

### Concurrency: two worktrees sharing one main-repo `.beads/`

This is the load-bearing operational test for Ralphy, which fans many workers
out across git worktrees that must all draw from one task graph. Setup
(`/tmp/bd-concurrency`): a `main` repo with `bd init`, an epic
`Change: concurrency-demo` with task children, plus a real git worktree
(`git worktree add /tmp/bd-concurrency/wt1`).

**How a worktree finds the shared `.beads/` (no daemon).** There is **no bd
daemon / dolt sql-server** running (`pgrep` empty). The git-tracked `.beads/`
scaffolding (`config.yaml`, `metadata.json`, hooks) is copied into the worktree
by git, but the gitignored `embeddeddolt/` is **not**. From the worktree, bd
walks up via the **git common dir** to the main repo's `config.yaml` and
resolves the database back to main's store:

```
$ bd -C /tmp/bd-concurrency/main where  | grep database
  database: /private/tmp/bd-concurrency/main/.beads/embeddeddolt
$ bd -C /tmp/bd-concurrency/wt1  where  | grep database
  database: /private/tmp/bd-concurrency/main/.beads/embeddeddolt   # same store
$ bd -C /tmp/bd-concurrency/wt1  where --verbose | grep config
  Debug: loaded config from /private/tmp/bd-concurrency/main/.beads/config.yaml
```

So the "shared `.beads/` in the main repo" model works **for free** — a worktree
worker hits main's task graph with no extra wiring. ✅ (`bd -C <dir>` or
`--db <path>` can also force the location explicitly if git discovery ever
fails after a worktree teardown.)

**`bd claim` is `bd ready --claim --json`** (atomic claim of the first matching
ready issue; there is no separate `bd claim` subcommand in 1.0.5).

**Test 1 — two worktrees, 4 ready tasks, simultaneous claim.** Both launched in
parallel as background jobs (no inter-process coordination):

```
$ ( bd -C .../main ready --claim --exclude-type=epic --limit 1 --json >c1 ) &
$ ( bd -C .../wt1  ready --claim --exclude-type=epic --limit 1 --json >c2 ) &
$ wait
main exit=0  wt1 exit=0
--- main claimed ---  "id":"main-s70" "title":"Mission task 3" "status":"in_progress"
--- wt1  claimed ---  "id":"main-hve" "title":"Mission task 4" "status":"in_progress"
```

Two **distinct** tasks, both flipped to `in_progress` with an assignee. No
double-claim. ✅

**Test 2 — contention on exactly ONE ready task.** The decisive double-claim
test: one ready task (`main-xlg`), two simultaneous claimers.

```
$ ( bd -C .../main ready --claim --exclude-type=epic --limit 1 --json >d1 ) &
$ ( bd -C .../wt1  ready --claim --exclude-type=epic --limit 1 --json >d2 ) &
$ wait
main exit=0  wt1 exit=0
[main] stdout: [ { "id":"main-xlg", "status":"in_progress", "assignee":"Neriya Rosner", ... } ]
[wt1 ] stdout: []          # clean empty array — lost the race, no error
```

**Exactly one winner; the loser gets an empty array, not the same task.** No
double-claim, no error, no partial write. ✅ This is the behaviour Ralphy needs:
the embedded-Dolt single-writer lock serialises the claim transaction.

**Integrity after the churn.** After Test 1 + Test 2 plus repeated concurrent
read/write bursts, the store is consistent — no duplicate IDs, every
`in_progress` issue has exactly one assignee, and the JSONL export round-trips
cleanly:

```
$ bd list --json  | (check)   total issues: 17   duplicate issue ids: NONE
                              in_progress missing assignee: none
$ bd export --output final.jsonl
$ (validate)                  JSONL export: 17 valid, 0 malformed
```

**No JSONL corruption** under concurrent worktree access. ✅

**⚠ Finding — silent empty output under write contention.** The single-writer
lock is real and exposed at the file level:

```
$ find .beads/embeddeddolt -iname '*lock*'
  .beads/embeddeddolt/.lock
  .beads/embeddeddolt/main/.dolt/noms/LOCK
```

Each `bd` invocation spins up its **own** embedded-Dolt engine (there is no
shared server), so they compete for that exclusive lock. When many `bd`
processes fire in rapid succession (tight loops, or right after a burst of
concurrent claimers), the losers **fail silently — empty stdout, exit 0, no
stderr** — rather than blocking or erroring. In one run, a loop of ~10 back-to-
back `bd create` calls produced **0** issues with no error; the same command,
spaced out by seconds, succeeds, and the store recovers on its own once the
burst subsides (no manual lock cleanup needed, no corruption).

This is **the** operational hazard for a `BeadsChangeStore`:

- An empty `bd ready --claim` result is **ambiguous** — it can mean (a) no work
  / change complete, OR (b) this process just lost the lock race. The loop must
  **never** treat an empty/timed-out bd response as "change done." Disambiguate
  with a _separate, retried_ `bd list --status open --parent <epic>` count (the
  blocked-vs-done distinguisher already in the mapping table) before concluding
  completion.
- Every bd call in the store must **retry with backoff** on empty/silent output,
  and ideally run with `--global`/server mode (`bd init --server`) so a single
  long-lived Dolt server serialises writes instead of N short-lived engines
  fighting over a file lock. Embedded mode is demonstrably lossy under Ralphy's
  fan-out; **a shared bd server is the recommended topology if we go.**

## Open questions → decision record

Each is now resolved from the spike evidence above.

### 1. Adapter vs. rip-and-replace — **Adapter** (`BeadsChangeStore` behind `ChangeStore`)

**Decision: adapter.** The prototype (`beads-change-store.spike.ts`) proves the
`ChangeStore` seam is sufficient: a `bd`-backed `readTaskList`/`getStatus`/
`validateChange` renders the markdown shape `buildTaskPrompt` already consumes,
so `loop.ts`, `tasks-md.ts`, and the flow machine stay untouched and the prompt
the worker sees is unchanged. A native rewrite (teaching `loop.ts` to consume
`bd ready --json` directly) buys nothing the adapter doesn't already deliver and
forfeits the ability to A/B the two backends or fall back to markdown. The one
genuinely native win — dropping `normalizeNewlyAppendedSection` — can be taken
later once bd is the sole backend; it is not a reason to skip the adapter step.

### 2. OpenSpec spec artifacts — **Keep OpenSpec; scope bd to tasks only** ✅ confirmed

bd has no concept of `proposal.md` / `design.md` / `specs/`, and
`deriveOpenSpecPhase` still needs the OpenSpec change dir to exist. Confirmed:
the change dir stays, bd backs **only** the task checklist. The prototype's
`getChangeDirectory` still returns `openspec/changes/<name>`. This also fixes the
JSONL-commit gap pragmatically: because the OpenSpec dir is already committed by
the worker, the implementation ticket should make the adapter run an explicit
`bd export` and stage `.beads/*.jsonl` in that same individual-file commit — the
gitignored Dolt store is treated as a rebuildable cache, the JSONL as the
durable, git-tracked source of truth.

### 3. Linear relationship — **bd is local sub-task SoT; Linear stays human layer; no bd↔Linear sync**

bd's built-in Linear sync (the source of the `⚠ Linear data has never been
pulled` nag on nearly every command) is **not** adopted. Ralphy already owns the
Linear integration at the issue level; bd's sync would create a second,
competing writer to Linear and a confusing two-way merge. Decision: bd is the
source of truth for _intra-change sub-tasks_ only; Linear remains the
human-facing issue layer fed by Ralphy's existing path. The implementation ticket
must **suppress/ignore the Linear-sync nag** (it goes to stderr, not inside
`--json`, so it is filterable) and must not run `bd linear sync`.

### 4. Flow/preemption modeling — **Keep the XState flow machine; bd only models the checklist**

The flow machine (`flow.machine.ts`) stays the authoritative stop/flow logic per
CLAUDE.md — the spike does not move preemption _decisions_ into bd. What bd
models is the _checklist representation_ of a flow task: when the machine decides
a CI-fix is needed, the adapter's `prependFixTask` equivalent creates a `-p 0`
bead that `blocks` mission work, and `bd ready` then surfaces it first (verified
✅). So: machine decides _when_ to preempt; bd's priority+`blocks` graph
_represents_ the preemption so selection stays a pure `bd ready` read. This keeps
the single source of truth for flow logic where CLAUDE.md mandates it.

### 5. `bd` binary dependency — **Acceptable only with a preflight + shared-server topology; this is the gating risk**

The footprint assumption did **not** hold: bd 1.0.5 pulls in Dolt + icu4c
(~250 MB+), not a lightweight static binary, and embedded mode is **lossy under
Ralphy's worktree fan-out** (silent empty output when short-lived Dolt engines
contend for the file lock). Acceptable **conditionally**: (a) a preflight check
mirroring the Bun preflight that fails fast with an install story if `bd` is
absent/incompatible, and (b) running a **single long-lived `bd` server**
(`bd init --server` / dolt sql-server) so writes serialise through one engine
instead of N processes fighting a file lock. Without the shared server the
backend is not safe for parallel workers. This is the load-bearing condition on
the whole "go".

## Recommendation: **conditional GO (adapter, behind a flag, server topology required)**

**Go** — the core thesis holds: every `tasks-md.ts` selection primitive has a
verified clean `bd` equivalent, the `ChangeStore` seam absorbs bd with zero loop
changes (prototype + parity test prove it), concurrent worktrees share one
main-repo store race-safely, and an entire class of file-clobber bugs
(`normalizeNewlyAppendedSection`) disappears.

**Conditional** — the go is gated on three things the spike surfaced, none of
which are graph-expressiveness problems; all are operational:

1. **Run bd as a shared server, not embedded per-call.** Embedded mode drops
   results under fan-out contention. This is non-negotiable for parallel workers.
2. **Never infer completion from empty `bd ready`.** Use the retried
   open-children count (already implemented in the prototype's `getStatus`).
3. **Add a `bd` preflight + own the JSONL commit.** Fail fast if `bd` is missing;
   export-and-stage `.beads/*.jsonl` in the worker's individual-file commits so
   DB state and git never drift.

If any of the three cannot be met, the recommendation flips to **no-go** — the
markdown backend, for all its fragility, does not silently lose a task under
load.

### Follow-up implementation ticket outline (if go proceeds)

**RLF-NNN — Implement `BeadsChangeStore` as an opt-in task backend (server topology)**

- **Scope:** Promote the throwaway prototype to a real package
  (`packages/beads/` consuming `@ralphy/change-store`), wired in _behind a
  feature flag / config_, default still `OpenSpecChangeStore`. No removal of
  `tasks-md.ts`.
- **Read-path:** Port `readTaskList`/`getStatus`/`validateChange` from the spike;
  keep the open-children completion rule and the silent-empty retry/backoff.
- **Write-path (the new work):** Implement `writeTaskList` completion as
  `bd close <id> --reason`, `prependFixTask` as create-`-p 0`-then-`dep add`-
  then-verify, and `appendSteering` headline→bead. Own `bd export` + individual
  staged commit of `.beads/*.jsonl`.
- **Topology:** Stand up/health-check a single `bd` server for the run; route all
  worktree workers through it. Add a `bd` preflight (mirror the Bun preflight)
  with an install story (`brew install beads`, server bootstrap), and a scoped,
  non-interactive `.beads/` init that does **not** clobber Ralphy's `CLAUDE.md` /
  `.claude/` / hooks.
- **Migration:** One-shot importer that reads existing `tasks.md` checkboxes into
  an epic+children bead graph for in-flight changes.
- **Flow integration:** Have the XState flow machine's preemption actions call
  the adapter's flow-bead path; the machine stays the source of truth for _when_.
- **Validation gate:** Run the existing loop end-to-end against the bd backend on
  a throwaway change under simulated two-worktree contention; assert no
  double-claim, no dropped task, no DB/JSONL drift across a full run.
- **Out of scope:** bd↔Linear sync, removing the markdown backend, native
  `loop.ts` consumption of `bd ready`.
