# Design for RLF-158

## Root Cause

In `prepare.ts`, `renderWorkflowPrompt` is called with `issue.description` in the context. The workflow template body (both `DEFAULT_WORKFLOW_MD` and the project's `WORKFLOW.md`) renders `{{ issue.description }}`, so the resulting string contains the description. That string is then passed as `appendPrompt` to `scaffoldChangeForIssue`, which embeds it verbatim under `## Additional instructions`.

Meanwhile, `scaffoldChangeForIssue` already puts `issue.description` under `## Why`. Result: the description appears twice in `proposal.md`.

## Files to Touch

| File                                               | Change                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/workflow/src/default.ts`                 | Remove `\n{{ issue.description }}\n` from template body                       |
| `WORKFLOW.md`                                      | Remove `\n{{ issue.description }}\n` from body section                        |
| `packages/workflow/src/__tests__/workflow.test.ts` | Add test: rendered default workflow body does not include `issue.description` |

## Data Flow After Fix

```
prepare.ts
  renderWorkflowPrompt(workflow, { issue, ... })
    → renders template body WITHOUT {{ issue.description }}
    → workflowPrompt has rules/boundaries/instructions but NOT the description
  appendPrompt = workflowPrompt (no description)

scaffoldChangeForIssue(…, appendPrompt)
  proposal[## Why] = issue.description       ← only occurrence
  proposal[## Additional instructions] = appendPrompt  ← no description
```

## Edge Cases

- Existing `proposal.md` files already scaffolded with the old template still have the duplicate. This change only prevents future duplication; no backfill needed.
- Users with custom `WORKFLOW.md` that explicitly include `{{ issue.description }}` will still get duplication. This is out of scope — we fix the defaults and the project file.
- `renderWorkflowPrompt` is also used for per-iteration prompts (not just scaffolding). Removing the description from the template means the description won't be re-injected each iteration, but the agent already has it via `proposal.md` in its context.
