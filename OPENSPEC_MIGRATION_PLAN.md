# OpenSpec Migration Plan

**Branch**: `claude/simplify-paths-openspec-ZAuDU`
**Status**: Draft — awaiting user sign-off before implementation
**Scope**: Full replacement — rip out ralphy's custom documents/phases/scaffolds and run the loop over OpenSpec's canonical artifact set.

> This is a planning document. No code has been changed yet. Once you approve (or redirect), I'll execute the steps in order and commit per step.

---

## 1. Current state (what's being replaced)

### 1.1 Hard-coded file names

Found across the codebase (via `Grep` on each literal):

| Current file        | Code that writes/reads it                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `spec.md`           | `packages/core/src/documents.ts:24`, `templates.ts:46-49`, phase `requires:` in `research.md`, phase context lists |
| `RESEARCH.md`       | `documents.ts:35`, phase `requires:` in `plan.md`, phase context                                                   |
| `PLAN.md`           | `documents.ts:41`, phase `requires:` in `exec.md`, scaffolds                                                       |
| `PROGRESS.md`       | `documents.ts:47`, `loop.ts:80`, `phases.ts:32,80-146`, `tools.ts:97,152,584`                                      |
| `STEERING.md`       | `documents.ts:53`, `loop.ts:262-266`, scaffolds, many phase prompts                                                |
| `MANUAL_TESTING.md` | `documents.ts:66`, scaffolds                                                                                       |
| `INTERACTIVE.md`    | `documents.ts:77`, `tools.ts:485`                                                                                  |
| `STOP`              | `loop.ts:142`, referenced in every phase prompt                                                                    |
| `state.json`        | `state.ts:8`                                                                                                       |
| `_interactive_done` | `tools.ts:488` (signal file)                                                                                       |

### 1.2 Dynamic paths (constructed per-task)

| Source                              | Shape                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `apps/cli/src/index.ts:16-24`       | walks up from cwd to find `.ralph/tasks/`                                       |
| `packages/core/src/init.ts:12`      | creates `.ralph/tasks/` and `.ralph/.gitignore`                                 |
| `packages/content/src/content.ts`   | resolves `packageRoot/{scaffolds,tasks,phases,checklists}`                      |
| `packages/core/src/templates.ts:30` | `scaffoldTaskDocuments(taskDir, prompt)` writes scaffolded files into each task |

### 1.3 Phase + scaffold assets to delete

- `packages/content/phases/{specify,research,plan,exec,review,done}.md`
- `packages/content/scaffolds/{STEERING,PLAN,PROGRESS,MANUAL_TESTING}.md`
- `packages/content/checklists/{static,tests,deploy}.md` (keep optionally — see §5)
- Top-level `specs/001-test-task/` (legacy example)

### 1.4 Code that goes away

- `packages/core/src/documents.ts` — entire `TaskDocument` registry.
- `packages/core/src/templates.ts` — `scaffoldTaskDocuments`, `scaffoldTasksDir`.
- `packages/core/src/phases.ts` — phase transition/inference logic (replaced by much smaller OpenSpec-aware logic).
- `packages/phases/` — whole package (phase loader, frontmatter schema, checklists API).
- `packages/core/src/progress.ts` — counting `- [ ]` in PROGRESS.md (replaced by counting in `tasks.md`).
- Phase-related fields in `StateSchema` (`phase`, `phaseIteration`).
- MCP tools: `ralph_advance_phase`, `ralph_update_steering`, `ralph_list_checklists`, `ralph_apply_checklist`, `ralph_finish_interactive`, and the phase/document params on the rest.
- CLI modes: `advance`, `set-phase`, `--phase`, `--no-execute`, `--interactive`.

---

## 2. Target state (OpenSpec canonical)

### 2.1 New on-disk layout

Per-task artifacts live under an OpenSpec change directory:

```
openspec/
├── changes/
│   └── <change-name>/
│       ├── .openspec.yaml        ← { schema: spec-driven, created: YYYY-MM-DD }
│       ├── proposal.md           ← Why / What Changes / Capabilities
│       ├── design.md             ← Technical Approach (+ optional Architecture Decisions / Data Flow / File Changes)
│       ├── tasks.md              ← ## N. Section  →  - [ ] N.M item
│       ├── specs/<cap>/spec.md   ← ADDED / MODIFIED / REMOVED Requirements (delta form)
│       └── .ralph-state.json     ← ralphy-only: iteration counters, usage totals, history
└── specs/                        ← main specs merged here on archive
```

Ralphy stops creating `.ralph/tasks/<name>/`. The only ralphy-owned file inside a change is `.ralph-state.json` (runtime metadata that has no OpenSpec equivalent).

### 2.2 Lifecycle (replaces phases)

OpenSpec's native flow maps to a **single looping step** — no `research / plan / exec / review` distinction on our side:

| Ralphy old                    | OpenSpec replacement                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `specify` writes `spec.md`    | `openspec init` (once per repo) + ralphy scaffolds `proposal.md` + `specs/<cap>/spec.md` stub |
| `research` writes RESEARCH    | folded into `proposal.md` "Why" + `design.md` "Technical Approach" in one iteration           |
| `plan` writes PLAN + PROGRESS | folded into `design.md` + `tasks.md` in one iteration                                         |
| `exec` implements sections    | iterates through unchecked `tasks.md` items, one section per iteration, as before             |
| `review` loops back if issues | replaced by per-iteration `openspec validate <change>` — failures re-run the exec iteration   |
| `done`                        | `openspec archive <change>` on exit                                                           |

### 2.3 Replacement for "STOP" and "STEERING"

- **Steering**: a dedicated `## Steering` section appended to `proposal.md` at the bottom. Ralphy injects only this section into every iteration prompt (same 20-line cap). No new file.
- **STOP signal**: a `status: blocked` line in `.ralph-state.json` + a reason comment — no sentinel file. MCP tool `ralph_stop(name, reason)` replaces `echo > STOP`.
- **INTERACTIVE.md**: folded into a `## Interactive Notes` section of `proposal.md`.
- **MANUAL_TESTING.md**: folded into a `## Manual Testing` section of `design.md`.

---

## 3. Step-by-step implementation

Each step is one commit. Tests and typecheck must pass before moving on.

### Step 1 — Add OpenSpec adapter package

`packages/openspec/` (new). Thin, process-local wrapper around the `@fission-ai/openspec` CLI.

- `changeDir(name)` → `openspec/changes/<name>`
- `initChange(name, description)` → writes `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `specs/<cap>/spec.md` stubs.
- `validate(name)` → `openspec validate <name> --json` → returns `{ valid, warnings, errors }`.
- `archive(name)` → `openspec archive <name> -y`.
- `listChanges()` → `openspec list --changes --json`.
- `readTasks(name)` / `writeTasks(name, content)`.
- `appendSteering(name, message)` → rewrites `## Steering` section in proposal.md.
- `readSection(name, artifact, heading)` — helper used by the loop.

Invocation strategy: shell out to the `openspec` binary (required via `bunx @fission-ai/openspec` fallback if not globally installed — same pattern as current Claude CLI).

### Step 2 — Replace `packages/types` State schema

Drop phase-related fields. New minimal shape:

```ts
const StateSchema = z.object({
  version: z.literal("2"),
  name: z.string(),
  prompt: z.string(),
  iteration: z.number().default(0), // replaces phaseIteration + totalIterations
  status: z.enum(["active", "blocked", "completed"]).default("active"),
  stopReason: z.string().optional(),
  createdAt: z.string(),
  lastModified: z.string(),
  engine: z.enum(["claude", "codex"]).default("claude"),
  model: z.string().default("opus"),
  usage: UsageSchema.default({}),
  history: z.array(HistoryEntrySchema).default([]),
  metadata: z.object({ branch: z.string().optional() }).default({}),
});
```

Drop `PhaseFrontmatterSchema`, `PhaseConfig`, `ContextEntrySchema`.

### Step 3 — Replace the loop

`packages/core/src/loop.ts` becomes linear:

```
buildPrompt(state, changeDir):
  read proposal.md "## Steering" section (cap 20 lines) → inject at top
  read first unchecked section of tasks.md → inject as "Current Work"
  append base OpenSpec instructions (Why/Spec references, validate command)
```

Stop conditions (cost / runtime / iterations / consecutive failures) live exclusively in the `loopMachine` guards (`maxIterationsReached`, `costCapReached`, `runtimeLimitReached`, `consecutiveFailuresReached`), consumed by `createLoopRunner`.
`autoTransitionAfterIteration` → on zero unchecked tasks, mark `status: completed` and call `openspec archive`.
Terminal signal = `status !== "active"`.

### Step 4 — Replace CLI surface

Remove: `advance`, `set-phase`, `--phase`, `--no-execute`.

Keep / rename:

- `ralph task --name <change-name> --prompt "..."` — creates the change via `initChange`, then loops.
- `ralph task --name <change-name>` (resume)
- `ralph list` — wraps `openspec list --changes` + our iteration counts.
- `ralph status --name <change-name>` — wraps `openspec show <change> --json` + our usage stats.
- `ralph stop --name <change-name> --reason "..."` — replaces STOP file.
- `ralph init` — runs `openspec init` for the user if `openspec/` is missing, then writes `.ralph-state` dir.

Flags `--max-iterations`, `--max-cost`, `--max-runtime`, `--max-failures`, `--claude/--codex`, `--model`, `--delay`, `--log`, `--verbose` unchanged.

### Step 5 — Delete phase assets

Remove:

- `packages/phases/` (entire package, references in `tsconfig.base.json`, `nx.json`, workspace package.json).
- `packages/content/phases/` (6 files).
- `packages/content/scaffolds/` (4 files).
- `packages/core/src/{documents,phases,templates,progress}.ts`.
- Top-level `specs/001-test-task/` (optionally migrate to `openspec/changes/archive/` as an archived example; propose deletion).

### Step 6 — Slim MCP server

Replace the 9 existing tools with 5:

- `ralph_list_changes` (was list_tasks)
- `ralph_get_change` (was get_task) — returns status, iteration, unchecked task count
- `ralph_create_change` (was create_task + run_task merged)
- `ralph_append_steering` (was update_steering, appends to `## Steering` in proposal.md)
- `ralph_stop` (replaces STOP file)

Delete: `ralph_read_document`, `ralph_advance_phase`, `ralph_list_checklists`, `ralph_apply_checklist`, `ralph_finish_interactive`.

### Step 7 — Rewrite the single base prompt

Replace six phase prompts with **one** prompt in `packages/content/base-prompt.md`:

- Explains OpenSpec layout.
- Tells the agent to work on the first unchecked section of `tasks.md`.
- Requires `openspec validate <change>` before committing.
- If validation fails: append issues as new items to the same section and re-run next iteration.
- After last unchecked item: call `ralph stop --reason completed` (or the MCP equivalent), which triggers archive.

Injections stay minimal: Steering section + Current Work section.

### Step 8 — Update CLAUDE.md, README.md, tests

- README: replace "Phases" table with the OpenSpec flow.
- CLAUDE.md: note the new `openspec/` directory; drop `.ralph/tasks/` references.
- Delete/rewrite: `packages/phases/src/phases.test.ts`, `packages/core/src/__tests__/phases.test.ts`, document-related tests. Add tests for the new loop + OpenSpec adapter.

### Step 9 — Migration shim (optional, ask user)

Two options:

- **(a) Clean break**: existing `.ralph/tasks/` is ignored. Users re-create their tasks as OpenSpec changes.
- **(b) One-shot migrator**: `ralph migrate` command translates each `.ralph/tasks/<name>/` into `openspec/changes/<name>/` (spec.md→proposal.md, PLAN.md→design.md, PROGRESS.md→tasks.md), archives STEERING/MANUAL_TESTING into appropriate sections.

Default to (a) given the "full replacement" directive; flag for your decision before implementing.

---

## 4. Blast-radius summary

| Area                | Files changed | Files deleted |
| ------------------- | ------------: | ------------: |
| `packages/types`    |             1 |             0 |
| `packages/core`     |             2 |             5 |
| `packages/phases`   |             0 |    entire pkg |
| `packages/content`  |             2 |           ~13 |
| `packages/openspec` |      new (~5) |             0 |
| `apps/cli`          |           2–3 |             0 |
| `apps/mcp`          |             2 |             0 |
| `specs/`            |             0 |    entire dir |
| Docs                |             2 |             0 |

Expected net: **~20 files deleted, ~15 modified, ~5 added**.

---

## 5. Open questions for you

Please tick one per question before I start implementing:

1. **OpenSpec CLI dependency**
   - [ ] (a) Add `@fission-ai/openspec` to `package.json` devDependencies; ralphy shells out to local `bunx openspec`.
   - [ ] (b) Require users to install `openspec` globally; ralphy just spawns it. (Smaller blast radius, matches how Claude CLI is handled today.)

2. **Checklists** (`packages/content/checklists/{static,tests,deploy}.md`)
   - [ ] (a) Delete — agent reads repo's `CLAUDE.md` for verification steps.
   - [ ] (b) Convert each into an OpenSpec "template" reusable during `openspec instructions`.

3. **Example change** (`specs/001-test-task/`)
   - [ ] (a) Delete.
   - [ ] (b) Convert to `openspec/changes/archive/2026-04-19-001-test-task/`.

4. **Migration path for existing `.ralph/tasks/`**
   - [ ] (a) Clean break, document the jump in README.
   - [ ] (b) Add `ralph migrate` one-shot translator.

5. **UI app** (`apps/ui/`) — I haven't inspected it yet. Does it display task state? If so, step 4 will need an extra sub-step to point it at the new state file + OpenSpec change list.

---

## 6. What happens after approval

Once you approve:

1. I execute Steps 1–8 in order, one commit per step, running `bunx nx affected -t lint,typecheck,test,build` between each.
2. Step 9 only if you picked option (b) in Q4.
3. Push to `claude/simplify-paths-openspec-ZAuDU`. No PR unless you ask.

Reply with your picks for §5, any corrections to §2/§3, and the word **"go"** to start implementing — or tell me what to adjust.
