---
name: no-duplicate-enums
enabled: true
event: file
conditions:
  - field: new_text
    operator: regex_match
    pattern: (z\.enum\(\[|z\.nativeEnum\(|enum\s+\w+\s*\{|=\s*\[.*\]\s*as\s+const|["']\s*\|\s*["']|\bconst\s+\w+\s*=\s*\{[^}]*\}\s*as\s+const)
---

**Enum / const / literal definition detected — check for duplicates first.**

Before defining new enum values, string literals, or `as const` objects, search the codebase for existing definitions:

```
grep -r "USER\|ADMIN\|<your values>" libs/ src/
```

Common places to check:

- `libs/mod-*/src/types.ts` — domain enums live here
- `libs/mod-*/src/schema.ts` — Zod schemas with `.enum()`
- Shared domain libs (`mod-auth`, `mod-player`, etc.)

If an equivalent already exists, **import and reuse it** rather than redefining. Duplicate enum values cause silent divergence when one is updated and the other isn't.
