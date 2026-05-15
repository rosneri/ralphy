# Design for RLF-22

## Files to touch

- `apps/agent/src/agent/linear.ts`
  - Add `addReactionToComment(apiKey, commentId, emoji)` using a GraphQL
    `reactionCreate` mutation. Returns void; throws on non-success so callers
    can log.
- `apps/agent/src/agent/wire.ts`
  - Add `addGithubReactionToComment(commentApiUrl, emoji)` that shells out to
    `gh api -X POST <url>/reactions -f content=<reaction-name>` (mapping
    `👀` → `eyes`, the GitHub reaction-name slug).
  - In `fetchMentions()` (around lines 1206–1288), after each new mention is
    appended to `out`, fire the appropriate reaction call wrapped in
    `try/catch` that logs and continues.
- `apps/agent/src/agent/__tests__/linear.test.ts` (extend existing or new file)
  - Mock `fetch` and assert the `reactionCreate` mutation payload.
- `apps/agent/src/agent/__tests__/wire.test.ts` (extend existing or new file)
  - Mock `Bun.spawn`/`gh` invocation and assert the reactions endpoint is
    called with `content=eyes`.
  - Cover the swallow-error path: `addReaction` throws → mention still appears
    in returned list.

## Data flow

1. Coordinator polls `fetchMentions(state)` once per tick.
2. `fetchMentions` walks done-state issues; for each Linear issue it queries
   comments via GraphQL, for each GitHub PR it shells `gh api` to fetch issue
   comments and review comments.
3. For every comment whose body contains `mentionHandle` (default `@ralphy`)
   and whose `createdAt > lastRalphPickup`, push a `MentionTrigger` to `out`.
4. **NEW**: immediately after pushing, invoke the matching reaction helper:
   - Linear comment → `addReactionToComment(apiKey, comment.id, "👀")`.
   - GitHub issue comment → POST to
     `repos/{owner}/{repo}/issues/comments/{id}/reactions` with
     `content=eyes`.
   - GitHub PR review comment → POST to
     `repos/{owner}/{repo}/pulls/comments/{id}/reactions` with
     `content=eyes`.
5. Errors from step 4 are caught locally and routed to the same `log()` used
   by the surrounding code; the trigger is still returned.

## Reaction-endpoint mapping

| Source                   | Endpoint                                             | Reaction slug |
| ------------------------ | ---------------------------------------------------- | ------------- |
| Linear comment           | GraphQL `reactionCreate(commentId, emoji: "👀")`     | `👀`          |
| GitHub issue comment     | `POST /repos/{o}/{r}/issues/comments/{id}/reactions` | `eyes`        |
| GitHub PR review comment | `POST /repos/{o}/{r}/pulls/comments/{id}/reactions`  | `eyes`        |

For GitHub we already have the comment URL (or id) in the JSON returned by
`gh api`. We carry the per-comment id and source-kind through to the reaction
call instead of re-deriving it.

## Edge cases

- **Mention found in a body Ralphy itself wrote** — already filtered by the
  existing pickup-cursor logic; nothing extra needed.
- **Reaction already exists** — GitHub returns 200 with the existing reaction
  id; Linear `reactionCreate` is idempotent on (user, comment, emoji). Either
  way we treat it as success.
- **Missing `LINEAR_API_KEY` / `GITHUB_TOKEN`** — the existing fetch already
  fails in that case, so the reaction call will fail the same way; we log and
  move on.
- **Network blip / 5xx** — swallowed; the next poll cycle won't retry because
  `lastRalphPickup` has advanced. This is acceptable: the user gets the
  spawned-task reply as a fallback signal.
- **`mentionTrigger: false`** — `fetchMentions` already short-circuits, so no
  reaction is attempted.
