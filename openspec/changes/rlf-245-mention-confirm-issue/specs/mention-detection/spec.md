# mention-detection — stop echoing mentions and harden the trigger filter

## MODIFIED Requirements

### Requirement: buildMentionAckComment MUST NOT echo the original mention

The acknowledgment comment MUST contain only the unified title, the greeting line, and the `mention-ack` marker — never a blockquote or any copy of the original mention body.

`buildMentionAckComment(body, author?)` in
`packages/core/src/detections/mention.ts` builds the comment Ralphy posts when
it picks up an `@ralphy` mention. It MUST lead with the unified title
`🤖 Ralphy · picked up your mention`, include the greeting
(`Got it, <author> — picked up your mention and queued a review pass.` when an
author is known, otherwise
`Acknowledged — picked up your mention and queued a review pass.`), and end with
the `<!-- ralphy:v=1 type=mention-ack -->` marker.

The returned body MUST NOT contain a markdown blockquote line (a line beginning
with `>`), and MUST NOT contain any excerpt, truncation, or other copy of the
incoming `body` argument. The handle of the mention is therefore never
re-emitted inside a Ralphy-authored comment.

#### Scenario: ack carries title, greeting, and marker but no quote

- **Given** a mention body `@ralphy please retry`
- **When** `buildMentionAckComment("@ralphy please retry", "alice")` is called
- **Then** the result starts with `🤖 Ralphy · picked up your mention`
- **And** the result contains `Got it, alice — picked up your mention`
- **And** the result contains `<!-- ralphy:v=1 type=mention-ack -->`
- **And** the result does NOT contain `> @ralphy please retry`
- **And** the result does NOT contain any line beginning with `>`

#### Scenario: no author uses the Acknowledged greeting and still omits the quote

- **Given** a mention body `@ralphy please retry` with no author
- **When** `buildMentionAckComment("@ralphy please retry")` is called
- **Then** the result contains `Acknowledged — picked up your mention`
- **And** the result does NOT contain `@ralphy please retry`

#### Scenario: long multiline mention is not echoed or truncated

- **Given** a mention body whose first line exceeds 200 characters followed by
  additional lines
- **When** `buildMentionAckComment(body)` is called
- **Then** the result does NOT contain any portion of `body`
- **And** the result does NOT contain a truncation ellipsis `…`

### Requirement: hasMentionTrigger MUST skip Ralphy-emitted comments via the unified marker

The mention-trigger filter MUST treat any comment recognised by `isRalphyComment` as not-a-mention, in addition to comments flagged by the caller's `isRalph` boolean.

`hasMentionTrigger(inputs)` in `packages/core/src/detections/mention.ts` MUST
return `true` only for a comment that contains the trigger phrase
(case-insensitive substring) AND is neither flagged `isRalph` by the caller NOR
recognised as a Ralphy-emitted message by `isRalphyComment` from `@ralphy/comms`
(which matches the unified `🤖 Ralphy` title, the `<!-- ralphy:… -->` marker,
and the legacy emoji-led leads).

A Ralphy-authored comment can therefore never be counted as a mention even if
the caller mis-set or omitted `isRalph`, closing the duplicate-mention loop at
the filter level as well as by removing the echoed handle.

#### Scenario: marker-bearing Ralphy comment is not a mention even when isRalph is false

- **Given** a comment whose body carries `<!-- ralphy:v=1 type=mention-ack -->`
  and also contains the trigger phrase, supplied with `isRalph: false`
- **When** `hasMentionTrigger` is called with that comment
- **Then** it returns `false`

#### Scenario: titled Ralphy comment is not a mention

- **Given** a comment whose body starts with `🤖 Ralphy · picked up your mention`
  and contains the trigger phrase, supplied with `isRalph: false`
- **When** `hasMentionTrigger` is called with that comment
- **Then** it returns `false`

#### Scenario: genuine human mention is still detected

- **Given** a plain human comment containing the trigger phrase with
  `isRalph: false` and no Ralphy title or marker
- **When** `hasMentionTrigger` is called with that comment
- **Then** it returns `true`
