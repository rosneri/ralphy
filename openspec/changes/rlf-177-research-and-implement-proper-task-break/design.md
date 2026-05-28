# Design for RLF-177

## Problem

The planning phase currently tells the agent to write PROGRESS.md with "3-8 items per section" and to "include test items alongside implementation items." This guidance is too loose — agents produce checklists that:

- Batch multiple changes into a single item ("update X, Y, and Z")
- Skip caller updates when an interface changes
- Omit test items for new behavior
- Miss cleanup and verification steps
- Produce 3-4 coarse items instead of 10-15 atomic ones

The root cause: the plan.md prompt asks agents to _summarize_ changes at the task level rather than _enumerate_ every atomic change.

## Methodology

After evaluating WBS (Work Breakdown Structure), INVEST criteria, CPM (Critical Path Method), TDD cycles, and thin-slice approaches, the solution combines:

1. **WBS at the symbol level** — decompose until each leaf is "one change to one artifact"
2. **Caller completeness** — for every interface change, enumerate all consumers
3. **TDD pairing** — each behavior change immediately paired with a test item
4. **Topological ordering** — dependency graph drives section ordering

## Files to Touch

| File                                               | Change                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/content/phases/plan.md`                  | Replace Step 4 with 6-step atomic decomposition algorithm; add anti-patterns section |
| `packages/content/checklists/task-completeness.md` | New file: completeness checklist for auditing PROGRESS.md                            |
| `packages/content/scaffolds/PROGRESS.md`           | Update to show atomic item format with TDD pairs and file paths                      |
| `packages/content/scaffolds/PLAN.md`               | Add `## Traceability` section                                                        |

## Data Flow

```
RESEARCH.md
    │
    ▼
Step 4a: Change Inventory
  (file → symbol list)
    │
    ▼
Step 4b: Atomic Expansion
  (symbol → checklist item)
    │
    ▼
Step 4c: Caller Enumeration
  (interface change → consumer items)
    │
    ▼
Step 4d: TDD Pairing
  (behavior item → + test item)
    │
    ▼
Step 4e: Dependency Order
  (topological sort → sections)
    │
    ▼
Step 4f: Completeness Audit
  (task-completeness.md checklist)
    │
    ▼
PROGRESS.md (committed)
```

## Updated plan.md Step 4

Step 4 is replaced with this algorithm:

### 4a. Build the change inventory

For every file listed in RESEARCH.md as "will be modified":

- List every function, type, export, constant, or config key that will change
- Note the change type: add, modify, delete, rename

### 4b. Expand to atomic items

Convert each inventory entry to one checklist item:

- One item = one change to one artifact
- Format: `- [ ] [action] [symbol] in [file path]` (e.g. `- [ ] Add type ProgressItem to packages/core/src/progress.ts`)
- If the description includes "and", "also", or ",", split into separate items

### 4c. Enumerate callers

For each function/type whose signature changes:

- Look up all callers in RESEARCH.md
- Add one item per caller: `- [ ] Update call to [symbol] in [caller file]`
- Include test files that reference the changed interface

### 4d. Add TDD pairs

For each item that introduces or modifies observable behavior:

- Add the corresponding test immediately below it:  
  `- [ ] Add/update test for [behavior] in [test file]`
- New functions → new test
- Changed return type → updated assertion
- New error path → error test

### 4e. Order by dependency

Group items into sections where items within a section have no inter-dependencies:

- Section 1: foundational types/schemas (nothing depends on these yet)
- Section 2: core implementation (depends on types from Section 1)
- Section 3+: callers, integrations (depend on Section 2)
- Final section: lint, typecheck, build, integration tests

### 4f. Completeness audit

After drafting PROGRESS.md, verify:

- [ ] Every file from RESEARCH.md "files to modify" has at least one item
- [ ] Every changed interface has a caller update item for each consumer
- [ ] Every new behavior has a paired test item
- [ ] A final verification section exists (lint, typecheck, tests, integration)
- [ ] No item contains the word "and" as a conjunction for multiple changes
- [ ] No item is vague (no "improve", "clean up", "update as needed")

## New file: task-completeness.md

A reusable checklist (appended to PROGRESS.md final section) that covers:

- Types and schemas
- Implementation
- Caller updates
- Test coverage
- Static analysis (lint + typecheck)
- Integration / smoke test

## Edge Cases

- **Unchanged callers**: If a function's signature is unchanged but its behavior changes (e.g. new error thrown), callers that handle the error still need updating — add items.
- **Test-only changes**: If only tests change, no TDD pairing needed; but the test file itself is an atomic item.
- **New files**: For each new file, one item per exported symbol (not one item for "create the whole file").
- **Config/build changes**: Configuration changes are atomic items even though they're not TypeScript symbols.
- **Third-party integrations**: If a library upgrade changes an API, enumerate each usage site as a caller item.

## Risks & Open Questions

- Agents may still write coarse items despite the algorithm. The completeness audit step (4f) acts as the quality gate.
- Very large changes may produce 30+ items per section — this is correct and expected; section count can grow.
- The methodology applies to the AI-generated planning phase; human-written plans are unaffected.
