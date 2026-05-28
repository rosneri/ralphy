# Spec: Atomic Task Decomposition in Planning Phase

## ADDED Requirements

### Requirement: The planning phase MUST follow a 6-step atomic decomposition algorithm when creating PROGRESS.md

When the planning agent writes PROGRESS.md it MUST apply the following steps in order:
(1) Build a change inventory from RESEARCH.md listing every affected symbol per file;
(2) Expand each inventory entry to one checklist item per atomic change (one function, one type, one file — no batching);
(3) Enumerate every caller of changed interfaces as explicit checklist items;
(4) Add a TDD test item immediately after each item that introduces or modifies observable behavior;
(5) Order all items topologically by dependency so each item's dependencies appear in earlier sections;
(6) Run a completeness audit, verifying that all research-identified files, callers, and behaviors are covered.

#### Scenario: planning phase produces atomic items for a multi-symbol change

- **Given** a RESEARCH.md that documents changes to two exported functions in the same file
- **When** the planning phase runs and writes PROGRESS.md
- **Then** PROGRESS.md contains two separate checklist items — one per function — not a single batched item

#### Scenario: planning phase enumerates caller update items

- **Given** a RESEARCH.md that identifies three callers of a function whose signature will change
- **When** the planning phase runs and writes PROGRESS.md
- **Then** PROGRESS.md contains at least three items of the form "Update call to [function] in [caller file]"

#### Scenario: planning phase adds TDD pairs for behavior changes

- **Given** a checklist item that adds a new exported function
- **When** the planning phase runs
- **Then** the next checklist item in the same section is a test item for that new function

### Requirement: A task-completeness checklist file MUST exist in the checklists directory

The file `packages/content/checklists/task-completeness.md` MUST exist and MUST contain checklist items covering five categories: types/schemas, implementation items, caller updates, test coverage, and static analysis (lint + typecheck).

#### Scenario: checklist covers all required categories

- **Given** the task-completeness.md checklist exists
- **When** its items are read
- **Then** each of the five categories (types/schemas, implementation, callers, tests, static analysis) has at least one checklist item

## MODIFIED Requirements

### Requirement: The PROGRESS.md scaffold MUST demonstrate atomic item format with TDD pairs and explicit file-path references

The scaffold at `packages/content/scaffolds/PROGRESS.md` MUST show at least one example item that includes a specific file path (e.g. `packages/...`) and at least one example TDD-pair item.

#### Scenario: scaffold shows file-path references

- **Given** the PROGRESS.md scaffold
- **When** it is read by a planning agent
- **Then** it contains at least one example item that references a specific file path

### Requirement: The PLAN.md scaffold MUST include a Traceability section

The scaffold at `packages/content/scaffolds/PLAN.md` MUST include a `## Traceability` section that maps functional requirements to implementation items.

#### Scenario: scaffold includes traceability section

- **Given** the PLAN.md scaffold
- **When** it is read
- **Then** it contains a `## Traceability` heading
