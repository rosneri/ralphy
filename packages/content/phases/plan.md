---
name: plan
order: 2
requires: [RESEARCH.md]
next: exec
autoAdvance: null
loopBack: null
terminal: false
context:
  - type: file
    file: RESEARCH.md
    label: "Research Findings"
  - type: file
    file: spec.md
    label: "Specification"
---

# Task — Planning Phase

You have a RESEARCH.md with detailed codebase findings. Your job is to create an implementation plan and execution checklist.

**Input: `TASK_DIR/RESEARCH.md` (already exists)**
**Output: `TASK_DIR/PLAN.md` and `TASK_DIR/PROGRESS.md` (you create both)**

---

## Orient

0a. Study `CLAUDE.md` for build commands, conventions, patterns, and gotchas. This is the operational source of truth.
0b. Read `TASK_DIR/state.json` for task context: current phase, iteration count, history of previous runs, and any metadata.
0c. Read `TASK_DIR/RESEARCH.md` thoroughly — it contains the codebase analysis, file details, callsites, and dependency graph.
0d. Read `TASK_DIR/spec.md` — it contains the feature specification with functional requirements, success criteria, and key entities.
0e. You may do additional targeted searches if the research missed something, but most exploration should already be done.
0f. If PLAN.md and PROGRESS.md already exist, you are refining them — review, identify issues, improve.
0g. Phase iteration: {{PHASE_ITERATION}}. After committing, advance to execution (use `mcp__ralph__ralph_advance_phase` MCP tool if available, otherwise `ralph advance --name "{{TASK_NAME}}"`).

{{MCP_TOOLS}}

---

## Steps

### 1. Read the research

Read `TASK_DIR/RESEARCH.md` end to end. Absorb:

- Current state of every file that will be modified
- All callsites and consumers that need updating
- Existing code to reuse
- Discovered issues and edge cases
- Dependency graph and ordering constraints

### 2. Gap analysis

Compare the research findings against what the task requires. For each gap, note:

- What exists (if partial)
- What's missing
- Dependencies on other items
- Priority (critical path items first)

### 3. Create PLAN.md

Write `TASK_DIR/PLAN.md` with:

- A brief summary of the task and approach
- Key architectural decisions and trade-offs
- Files that will be created or modified
- Traceability: every functional requirement from spec.md mapped to implementation items
- Risks or open questions

### 4. Create PROGRESS.md

Write `TASK_DIR/PROGRESS.md` as a detailed execution checklist using the **atomic decomposition algorithm**:

**Step 4a — Inventory**: List every logical unit of work derived from the research and spec. One unit = one function, type, schema, route, or file. Do not group; do not summarize.

**Step 4b — Atomic expansion**: For each unit, write one checklist item per discrete change. A discrete change touches exactly one concern (add a field, rename a function, update a call-site). If an item requires explaining two separate things, split it.

**Step 4c — Caller enumeration**: For each modified signature or contract, add one item per call-site that must be updated. Reference the exact file path and function name from RESEARCH.md.

**Step 4d — TDD pairing**: For every implementation item, add a paired test item immediately after it: `- [ ] test: <what the test asserts> (path/to/test.ts)`. Tests live beside the code they verify, not in a separate section.

**Step 4e — Dependency ordering**: Sequence all items so that no item depends on an unchecked item above it. Types and schemas before implementations; implementations before call-site updates; call-site updates before integration tests.

**Step 4f — Completeness audit**: Before finalizing, verify against the task-completeness checklist (see `mcp__ralph__ralph_list_checklists`): every type/schema, every implementation unit, every caller, every test, and every static-analysis gate is represented.

Structure rules:

- Each `## Section N — Title` = one iteration (one agent invocation)
- Items within a section should be completable together in one iteration
- Later sections can depend on earlier sections
- Items within a section should be as independent as possible
- **Each item must include** a file path and function/symbol name — no bare descriptions
- **No vague items** like "improve performance" or "clean up code"
- **Include a final section** for integration testing, verification, and cleanup
- Section size is a consequence of the work, not a target — avoid merging unrelated items just to hit a count

---

### Anti-patterns to avoid

- **Bundling**: "Update all call-sites" is one item that hides N units of work — enumerate each call-site separately.
- **Orphan tests**: A test section at the bottom means tests are skipped when time runs short — pair each test with its implementation item.
- **Missing callers**: If a function signature changes, every caller is a separate item. Check RESEARCH.md's dependency graph.
- **Schema drift**: If a type changes, every consumer of that type (imports, validators, serializers) must appear in the checklist.
- **Implicit validation**: "It should work" is not a test item — write the assertion: `test: resolveConfig returns null when key is absent (src/config.test.ts)`.

### 5. Append verification checklists

Use `mcp__ralph__ralph_list_checklists` to see available verification checklists, then `mcp__ralph__ralph_apply_checklist` to append the relevant ones as final sections of PROGRESS.md before advancing to exec. Checklists are auto-appended during phase transition as a fallback, but explicitly choosing which ones to include is preferred.

### 6. Commit and advance

```
git add TASK_DIR/PLAN.md TASK_DIR/PROGRESS.md
git commit -m "plan: <task-name>"
```

Then advance to the execution phase so the next iteration starts correctly. Use `mcp__ralph__ralph_advance_phase` MCP tool if available, otherwise fall back to:

```
ralph advance --name "{{TASK_NAME}}"
```

**Stop after advancing. Do not implement anything.**

---

## Termination Signal

If you cannot proceed (e.g., research is insufficient, critical information is missing, or a dependency is unresolvable), write a file `TASK_DIR/STOP` containing a one-line reason. The loop will halt after this iteration.

Only use this for genuine blockers — not for normal completion (the loop handles that automatically).

---

## Rules

- **PLAN ONLY. Do NOT implement anything. Do NOT write application code.**
- Base your plan on the research findings — don't re-explore what's already documented.
- Ultrathink when analyzing architecture and priorities.
- Keep each checklist item a single implementable unit of work.
