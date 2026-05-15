# mention-trigger — read-confirmed reaction

## ADDED Requirements

### Requirement: agent reacts with eyes emoji to mentions it picks up

The agent MUST add an eyes-emoji reaction to every new `@ralphy` mention that
its mention-trigger poll detects on a Linear comment or a GitHub comment
(issue comment or PR review comment). The reaction MUST use the literal emoji
`👀` for Linear and the reaction slug `eyes` for GitHub. The reaction is a
fire-and-forget acknowledgement.

The reaction call MUST run inside `fetchMentions` immediately after the
mention is recorded, so the cursor advance and the reaction happen in the
same poll cycle that detected the mention.

A reaction failure (network error, missing auth, 4xx/5xx response) MUST be
caught and logged; it MUST NOT abort the surrounding poll, MUST NOT prevent
the mention from being enqueued for review work, and MUST NOT be retried on
the next poll cycle.

The reaction MUST be skipped (along with all mention-fetching) when
`mentionTrigger` is `false` in the workflow config.

#### Scenario: Linear mention gets an eyes reaction

- **Given** `mentionTrigger: true` and `mentionHandle: "@ralphy"`
- **And** a Linear comment on a done-state issue contains `@ralphy please look`
- **And** the comment's `createdAt` is newer than the issue's `lastRalphPickup`
- **When** the agent's poll cycle runs `fetchMentions`
- **Then** a `reactionCreate` GraphQL mutation is sent with that comment's id and emoji `👀`
- **And** the mention is also returned as a `MentionTrigger` for the coordinator to enqueue

#### Scenario: GitHub PR review comment gets an eyes reaction

- **Given** `mentionTrigger: true`
- **And** a PR review comment on a tracked PR contains `@ralphy fix this`
- **When** the agent's poll cycle runs `fetchMentions`
- **Then** `gh api -X POST /repos/{owner}/{repo}/pulls/comments/{id}/reactions -f content=eyes` is invoked
- **And** the mention is returned as a `MentionTrigger`

#### Scenario: reaction failure doesn't block enqueue

- **Given** a new `@ralphy` mention is detected on a Linear comment
- **And** the `reactionCreate` mutation throws (e.g. 500 from Linear)
- **When** `fetchMentions` finishes
- **Then** the failure is logged
- **And** the `MentionTrigger` is still present in the returned list so the coordinator enqueues review work

#### Scenario: mentionTrigger disabled means no reaction

- **Given** `mentionTrigger: false`
- **When** the agent's poll cycle runs
- **Then** no comments are fetched and no reaction is posted, regardless of comment contents
