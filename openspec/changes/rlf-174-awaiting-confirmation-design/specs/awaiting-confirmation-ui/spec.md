# Spec: awaiting-confirmation-ui

## MODIFIED Requirements

### Requirement: gated-tickets card renders all identifiers as a horizontal link list when multiple tickets are gating

When two or more changes are simultaneously awaiting confirmation, the `AgentMode` terminal UI MUST render a single card whose label is a horizontal list of **all** gated ticket identifiers as clickable links separated by `·`, and whose body SHALL show only the count. The dim "+N more awaiting confirmation" line SHALL NOT be rendered.

#### Scenario: single gated ticket — existing single-ticket card is unchanged

Given the `gatedTicketsRef` map contains exactly one entry with identifier `LIT-42`,
when the UI renders the gated-tickets section,
then a `LabeledBox` is rendered with `LIT-42` as a link in the label, the body shows the round counter, asked-ago elapsed time, and issue title, and no trailing "+N more" text appears.

#### Scenario: multiple gated tickets — horizontal link list in label

Given the `gatedTicketsRef` map contains entries for `LIT-42`, `LIT-43`, and `LIT-44`,
when the UI renders the gated-tickets section,
then a single `LabeledBox` is rendered with label `LIT-42 · LIT-43 · LIT-44` (each identifier as a clickable link), the body shows `[GATE] Awaiting confirmation · 3 tickets`, and no "+N more awaiting confirmation" text appears anywhere.

#### Scenario: no gated tickets — nothing is rendered

Given the `gatedTicketsRef` map is empty,
when the UI renders the gated-tickets section,
then nothing is rendered (the section returns null).
