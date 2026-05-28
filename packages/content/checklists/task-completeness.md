# Task Completeness

Use this checklist during PROGRESS.md authoring (Step 4f — Completeness audit) to verify no category of work is missing.

## Types & Schemas

- [ ] Every new or modified type/interface/schema is represented by a checklist item
- [ ] Every file that imports a changed type has a corresponding call-site update item
- [ ] Validation schemas (zod, yup, JSON Schema, etc.) are updated alongside their TypeScript counterparts

## Implementation

- [ ] Every function that must be created has its own item (file path + symbol name)
- [ ] Every function that must be modified has its own item (file path + symbol name + what changes)
- [ ] No item bundles two or more independent concerns — each is split into its own line

## Callers

- [ ] RESEARCH.md's dependency graph has been cross-checked: every caller of a changed signature has its own item
- [ ] Every re-export, barrel file, or index that surfaces a changed symbol is listed
- [ ] Every serializer, deserializer, or mapper that touches a changed shape is listed

## Test Coverage

- [ ] Every implementation item has a paired `test:` item immediately below it
- [ ] Each test item names the assertion, not just "add tests"
- [ ] Edge cases identified in RESEARCH.md or spec.md each have a dedicated test item

## Static Analysis

- [ ] A lint gate item is present in the final section
- [ ] A typecheck gate item is present in the final section
- [ ] A build gate item is present if the change touches public exports or bundled output
