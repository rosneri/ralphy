# Tasks for RLF-13

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-13/show-pr-status-conflicts-ci-failures-in-agent-list and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [ ] Add `apps/agent/src/agent/pr-status.ts` exporting `PrStatus` type and `fetchPrStatus(url, runner, cwd)` that runs `gh pr view --json state,isDraft,mergeable,statusCheckRollup,autoMergeRequest,createdAt` and maps results to the typed shape (including the `{ kind: "error", message }` sentinel for gh failures)
- [ ] Add `apps/agent/src/__tests__/pr-status.test.ts` covering: pass/fail/pending CI mapping, mergeable=CONFLICTING vs CLEAN vs UNKNOWN, autoMergeRequest present vs null, gh error sentinel
- [ ] Add a pure `assignTier(status)` + `sortRows(rows)` helper in `list.ts` (or a new sibling module) implementing the 5-tier ordering with `createdAt` tie-break and stable fallback for no-PR rows
- [ ] Add `apps/agent/src/__tests__/list-sort.test.ts` with table-driven tests for every tier and tie-break path
- [ ] Refactor `runList` in `apps/agent/src/list.ts`: fan out across buckets, dedupe by issue id, resolve PR URL, call `fetchPrStatus`, sort, and print a single unified Linear table with a new `PR Status` column (Identifier · Bucket · State · Title · PR Status · PR URL)
- [ ] Update the existing Linear-table format helpers so PR-status markers render (`✗conflict`, `✗ci`, `⏳ci`, `draft`, `auto-merge`, `merged`, `closed`, `?`, `(no PR)`) without breaking the column widths
- [ ] Manually smoke-test `bun run apps/agent agent list` against a worktree with at least one open PR, one conflicted PR (if available), and one no-PR ticket; capture before/after output in the PR description
- [ ] Run `bunx openspec validate rlf-13-show-pr-status-conflicts-ci-failures-in`
- [ ] Run `bun run lint`
- [ ] Run `bun run test`
- [ ] Stage and commit changed files individually, then push the branch and open the PR
