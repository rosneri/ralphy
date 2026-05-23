---
name: bug-fix-tdd
description: Enforce test-first workflow for bug fixes. Use whenever the user asks to fix a bug, defect, regression, or issue. Write a failing test that captures the bug AND a passing test for the correct behavior BEFORE touching production code, then fix and flip.
---

# Bug-fix TDD

When asked to fix a bug/issue/regression, follow this sequence. Do not skip steps.

## 1. Write tests first (before any production change)

Add two test cases:

- **bug_case**: asserts the CURRENT (broken) behavior. Passes today, will fail after the fix.
- **fix_case**: asserts the CORRECT behavior. Fails today, will pass after the fix.

Run the suite. Confirm: `bug_case` passes, `fix_case` fails. If this isn't true, you haven't reproduced the bug — stop and re-examine.

## 2. Apply the fix

Change production code only. Do not edit tests in this step.

## 3. Flip and verify

Run the suite. Expected result: `fix_case` passes, `bug_case` fails.

Now invert `bug_case` so it asserts the post-fix behavior (i.e. that the broken behavior no longer occurs). The final committed state must have both tests passing and both guarding against regression.

## Rules

- Never write the fix before the tests.
- Never delete `bug_case` — flip its assertion so it stays as a regression guard.
- If you can't write a failing test, say so explicitly and ask the user how to proceed. Don't fix blind.
