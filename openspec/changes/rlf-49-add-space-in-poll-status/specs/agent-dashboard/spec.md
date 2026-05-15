# agent-dashboard — POLL STATUS pipe alignment

## MODIFIED Requirements

### Requirement: POLL STATUS row separators MUST line up between rows

The POLL STATUS box MUST render the row-2 `│` separator at the same terminal column as the row-1 `│` separator. To achieve this the countdown segment (`secsToNextPoll !== null`, which renders `↺ <secs>s`) MUST occupy a fixed visual width of 7 columns, matching the existing `" ".repeat(7)` placeholder used when no countdown is available, so that the trailing `│` lands at the same column as the `│` after the row-1 status label (typically `Idle`).

#### Scenario: Countdown row aligns with the status row

- **Given** the dashboard has completed at least one Linear poll
- **And** `secsToNextPoll` is a positive integer (e.g. `33`)
- **When** the POLL STATUS box is rendered while row 1 shows `Idle`
- **Then** the `│` separator on row 2 is at the same terminal column
  as the `│` separator on row 1

#### Scenario: Placeholder row keeps its 7-column footprint

- **Given** the dashboard has completed at least one poll
- **And** `secsToNextPoll` is `null`
- **When** the POLL STATUS box is rendered
- **Then** the first column on row 2 is exactly 7 spaces wide and the
  `│` separator lands at the same column as the `│` on row 1
