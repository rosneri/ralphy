## Reapply lost implementation files (2026-05-21T22:28:53.318Z)

- [x] Reapply lost implementation files. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

**Resolution:** This is a manual-test change (per `proposal.md` and the RLF-128 precedent). There is no in-repo code deliverable — the deliverable is the manual test recipe in `tasks.md`/`spec.md` plus the result PR in `NeriRos/ralphy-rlf87-test#10` (verdict: FAIL, child issue RLF-152). The heuristic's "meta-only diff" check is a false positive for this class of change. The change files were inadvertently deleted (staged) in the working tree by an earlier archive operation; restored here so the branch diff against `main` matches the committed history.

```
The diff against `main` contains only meta files
(openspec/tasks.md and similar). The substantive implementation
is missing from the branch — likely deleted by an earlier commit
or absorbed by a merge from origin/main.

Files currently in the diff:
- openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/design.md
- openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/proposal.md
- openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/specs/manual-test-rlf-130/spec.md
- openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/tasks.md

Re-apply the actual implementation work the change is supposed
to ship. Inspect git history (`git log main..HEAD`) to see
what was created earlier and lost, then restore those files
(or reproduce the work). Commit the restored files so the next
iteration's diff against `main` contains real code, not
just meta files.
```
