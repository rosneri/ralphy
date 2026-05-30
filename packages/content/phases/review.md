---
name: review
order: 4
requires: []
next: exec
autoAdvance: allChecked
loopBack: exec
terminal: false
context:
  - type: currentSection
    label: "Current Section (to review)"
  - type: file
    file: spec.md
    label: "Specification (requirements to validate against)"
---

# Task — Review Phase

You review the work completed in the current execution section and identify any issues that need to be fixed.

**Input: `TASK_DIR/PROGRESS.md` (current section with completed items)**
**Output: Issues documented in PROGRESS.md or approval to advance**

---

## Orient

0a. Study `CLAUDE.md` for build commands, conventions, patterns, and gotchas.
0b. Read `TASK_DIR/state.json` for task context and previous execution results.
0c. Read the current section from `TASK_DIR/PROGRESS.md` — these are the items just implemented.
0d. Review the git diff/recent commits to see exactly what was changed.

{{MCP_TOOLS}}

---

## Steps

### 1. Code Review

For each implemented item in the current section:

- **Correctness** — Does the implementation match the item requirements exactly?
- **Patterns** — Does it follow existing code patterns and conventions?
- **Edge cases** — Are there missing edge cases or error scenarios?
- **Type safety** — No type errors or unsafe casts?
- **Dependencies** — Are all imports and dependencies correct?
- **Naming** — Are variable/function names clear and consistent?

### 2. Test Coverage Review

- **Test files created** — Are there tests for the new code?
- **Coverage** — Do tests cover normal paths and edge cases?
- **Integration** — Do tests verify the code works with existing code?
- **No regressions** — Did existing tests pass?

### 3. Spec Compliance Review

Cross-reference the implementation against spec.md:

- **Requirements coverage** — Does the implementation satisfy the functional requirements from spec.md?
- **Success criteria** — Are the measurable success criteria from spec.md met?
- **User scenarios** — Are all user scenarios from spec.md covered?
- **No orphan requirements** — Are any spec.md requirements unaddressed?

### 4. Lint & Type Safety

Run the project's lint and typecheck commands.

If there are errors:

- Document them as issues in PROGRESS.md (step 4)
- Do NOT fix them here — the execution phase will fix them

### 5. Document Issues

If you found **any problems**, add them to `PROGRESS.md` under the current section:

```markdown
- [x] Item name — Issue: [clear description of what's wrong]
```

Example:

```markdown
- [x] Add login button — Issue: Button missing error handling for failed login attempts
- [x] Create auth service — Issue: Type error on line 42: cannot assign string to AuthToken
```

Include enough detail that an implementation agent can fix the issue directly without re-reading the code.

### 6. Decision

**If issues found:**

- Do NOT advance
- Return to console with issues documented
- The loop will loop back to exec to fix them

**If NO issues found:**

- All items in section are correct
- Ready to advance to next section

---

## Rules

- **REVIEW ONLY. Do not implement or fix anything.**
- Be thorough — catching issues now prevents rework later
- If uncertain about an issue, document it anyway (better safe)
- Focus on correctness, not "nice to have" improvements
- Only block if the code doesn't work or is incorrect

---

## Termination Signal

If you discover a fundamental architectural issue that requires revisiting the plan, write `TASK_DIR/STOP` with a one-line reason.

Example: `echo "Discovered issue: Auth token storage conflicts with existing pattern" > TASK_DIR/STOP`

Only use this for genuine blockers, not normal issues that can be fixed in the next execution pass.
