---
name: no-obvious-comments
enabled: true
event: file
conditions:
  - field: new_text
    operator: regex_match
    pattern: (//|/\*)
---

**Comment detected — review before writing.**

Before adding this comment, ask: does it explain **WHY**, or does it restate what the code already says?

Only write a comment if it conveys a non-obvious why — a hidden constraint, a subtle invariant, a workaround for a specific bug, or behavior that would surprise a reader.

If removing the comment wouldn't confuse a future reader, **do not write it.**
