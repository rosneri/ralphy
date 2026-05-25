# RLF-158: Proposal has duplicate content

Source: [RLF-158](https://linear.app/neriros/issue/RLF-158/proposal-has-duplicate-content)
Status: In Progress
Assignee: Neriya Rosner
Labels: Bug

## Why

When Ralph scaffolds a new `proposal.md` for a Linear issue, it places the issue description in two places:

1. Under `## Why` — via `descriptionBody` in `scaffoldChangeForIssue`
2. Under `## Additional instructions` — because `renderWorkflowPrompt` uses the default workflow template body, which contains `{{ issue.description }}`, and the result is passed as `appendPrompt` to `scaffoldChangeForIssue`

This produces a proposal where the exact same text (description, labels) appears twice, making the document confusing and noisy.

## What Changes

- Remove `{{ issue.description }}` (and the surrounding blank line) from the body of `DEFAULT_WORKFLOW_MD` in `packages/workflow/src/default.ts`
- Remove `{{ issue.description }}` (and the surrounding blank line) from the body section of the project's `WORKFLOW.md`
- Add a regression test in `packages/workflow/src/__tests__/workflow.test.ts` verifying that the rendered default workflow prompt does not contain the issue description

## Steering

_Add steering notes here as the loop runs._
