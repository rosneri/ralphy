# mention-detection Specification

## ADDED Requirements

### Requirement: Mention scan MUST ignore Ralphy's own comments and code-span `@ralphy` references

The mention scanner (`apps/agent/src/agent/wire/mention-scan.ts`) MUST
treat the following as non-mentions, even when the configured
`linear.mentionHandle` literal appears in the body:

1. Any comment whose trimmed body starts with one of the emojis Ralphy
   uses to prefix its own Linear comments: `🤖`, `🔄`, `✅`, `✗`, `⚠`,
   `🔁`, or `📋` followed by `Ralph` / `Ralphy`. (Detected via
   `isRalphComment`.)
2. A `@ralphy` reference that only appears inside an inline code span
   (single backticks) or a fenced code block (triple backticks). The
   handle match (`containsHandle`) MUST strip code markup before
   testing for the handle.

#### Scenario: Ralphy's "📋 plan ready" comment must not self-mention

- **Given** a Linear issue whose latest comment body is
  `"📋 Ralphy plan ready for \`foo\` — review proposal.md / design.md / tasks.md and approve to continue, or reply with \`@ralphy revise: <reason>\` to send it back to design."`
- **And** `cfg.linear.mentionTrigger` is `true` and `mentionHandle` is `@ralphy`
- **When** the mention scanner iterates the issue's comments
- **Then** that comment is skipped by `isRalphComment`
- **And** no `MentionTrigger` is produced for the issue

#### Scenario: `@ralphy` mention inside a code span does not trigger

- **Given** a non-Ralphy comment with body
  `"see the example \`@ralphy revise: x\` in the docs"`
- **When** `containsHandle(body, "@ralphy")` runs
- **Then** it returns `false` (the code span is stripped before the
  regex runs)

#### Scenario: bare `@ralphy` mention still triggers

- **Given** a non-Ralphy comment with body `"hey @ralphy please look"`
- **When** `containsHandle(body, "@ralphy")` runs
- **Then** it returns `true`
