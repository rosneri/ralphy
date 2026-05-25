---
name: observability-no-console
enabled: true
event: file
action: block
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
    pattern: console\.(error|warn)\(
---

🚫 **`console.error` / `console.warn` are not allowed in source files.**

This project uses a structured logger (`@litrpg/observability`) that fans out to **Sentry** (prod) and **Spotlight** (dev). `console.error` / `console.warn` bypass both — the error is invisible in dashboards.

**Use instead:**

```ts
import { logger, reportError } from "@litrpg/observability";

// For caught errors:
reportError({ error, context: { module: "auth", action: "sign-out" } });

// For structured warnings/messages:
logger.warn({
  message: "request returned non-ok response",
  context: { module: "auth", action: "sign-out", tags: { status: String(response.status) } },
});
```

**Allowed exceptions** (rare): scripts under `scripts/`, test files, and CLI tooling. If this is one of those, the file path should already exclude this rule.
