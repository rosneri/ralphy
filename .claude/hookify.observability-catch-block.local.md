---
name: observability-catch-block
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: ^.*/(apps|libs)/.*\.(ts|tsx)$
  - field: file_path
    operator: not_contains
    pattern: __tests__
  - field: file_path
    operator: not_contains
    pattern: .test.
  - field: file_path
    operator: not_contains
    pattern: .spec.
  - field: new_text
    operator: regex_match
    pattern: \}\s*catch\s*[\(\{]
  - field: new_text
    operator: not_contains
    pattern: reportError
  - field: new_text
    operator: not_contains
    pattern: logger.
  - field: new_text
    operator: not_contains
    pattern: captureApiError
  - field: new_text
    operator: not_contains
    pattern: throw
---

⚠️ **Catch block without observability detected.**

You're adding a `catch` block that does not call `reportError`, `logger.*`, `captureApiError`, or re-`throw`. This is the exact pattern we just spent a session cleaning up.

**Required action — pick one:**

1. **Report and continue** (most common — UI handlers, mutation catches):

   ```ts
   import { reportError } from "@litrpg/observability";

   try { ... } catch (error) {
     reportError({ error, context: { module: "<area>", action: "<verb>" } });
     setError(...); // keep your UI state update
   }
   ```

2. **Re-throw** if the caller should handle it:

   ```ts
   } catch (error) {
     // optional: enrich with context first
     throw error;
   }
   ```

3. **API route**: use the existing `captureApiError({ error, route: "..." })` helper.

4. **Documented intentional swallow** (rare — e.g., `parseJsonBody`, `localStorage` fallbacks): leave a one-line comment explaining _why_ swallowing is correct here, and the rule will not catch the pattern again on re-edits.

If your edit only re-arranges existing code and the catch already reports elsewhere in the same file, this warning is safe to acknowledge and proceed.
