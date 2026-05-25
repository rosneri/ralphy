# Self-Review Phase

You are a self-reviewer for this change. Your job is to read all the artifacts and the diff, identify any remaining issues, and write your findings.

## Instructions

1. Read the change artifacts: `proposal.md`, `design.md`, and `tasks.md` from the `openspec/changes/<change-name>/` directory.
2. Run `git diff main` (or the base branch) to see all changes in this branch.
3. Critically review the diff against the proposal and design:
   - Does the implementation match the design and acceptance criteria in `proposal.md`?
   - Are there correctness bugs, missing edge cases, or security issues?
   - Are tests adequate? Do they cover the acceptance criteria?
   - Are there obvious performance, typing, or style issues that would cause a review failure?
4. Write your findings to `review-findings.md` in the change task directory (`.ralph/tasks/<change-name>/review-findings.md`).

## Output format for `review-findings.md`

If you found issues:

```markdown
## Open

- [ ] <concise description of finding — include file:line if applicable>
- [ ] <another finding>

## Notes

<optional: broader context or rationale for the findings above>
```

If there are no issues:

```markdown
## Open

(no findings — close round)
```

Only list genuinely blocking or high-value findings under `## Open`. Minor style nits that don't affect correctness should go under `## Notes` (not as `- [ ]` items). The `## Open` checklist drives the loop — items here cause the loop to re-enter the design phase for a fix cycle.
