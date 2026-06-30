export interface ParsedTicketIdentifier {
  /** Uppercased team key (e.g. "RLF"), or null when a bare number was given. */
  teamKey: string | null;
  /** The Linear issue number (e.g. 208). */
  number: number;
}

const TICKET_IDENTIFIER_RE = /^([A-Za-z]+)-(\d+)(?:-.*)?$/;

const TICKET_BARE_NUMBER_RE = /^(\d+)$/;

/**
 * Parse a single ticket identifier token. Accepts the full identifier form
 * (`RLF-208` / `rlf-208`, case-insensitive), a bare number (`208`), and a
 * change-name slug (`rlf-208-some-slug`, whose leading `<team>-<number>` is
 * extracted). Throws a descriptive `Error` on malformed input.
 */
export function parseTicketIdentifier(raw: string): ParsedTicketIdentifier {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("--ticket value cannot be empty");
  }
  const bare = TICKET_BARE_NUMBER_RE.exec(trimmed);
  if (bare) {
    return { teamKey: null, number: Number(bare[1]) };
  }
  const match = TICKET_IDENTIFIER_RE.exec(trimmed);
  if (!match) {
    const err = new Error(
      "--ticket value is not a Linear ticket (expected e.g. RLF-208 or 208)",
    ) as Error & { value?: string };
    err.value = raw;
    throw err;
  }
  return { teamKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}

/**
 * Resolve a list of raw `--ticket` tokens to a deduped set of Linear ticket
 * numbers, validated against the configured `team`.
 *
 * Throws when a full identifier's team key disagrees with `team`
 * (case-insensitive), or when a bare number is given but no `team` is
 * configured. Returns an empty array when `tokens` is empty (no constraint).
 */
export function resolveTicketNumbers(tokens: string[], team: string | undefined): number[] {
  const teamKey = team?.trim() ? team.trim().toUpperCase() : null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const token of tokens) {
    const { teamKey: parsedTeam, number } = parseTicketIdentifier(token);
    if (parsedTeam !== null) {
      if (teamKey !== null && parsedTeam !== teamKey) {
        const err = new Error("--ticket identifier is not in the configured team") as Error & {
          ticket?: string;
          team?: string | undefined;
        };
        err.ticket = token;
        err.team = team;
        throw err;
      }
    } else if (teamKey === null) {
      const err = new Error(
        "--ticket bare number needs a configured team; pass --linear-team or set linear.team in config",
      ) as Error & { ticket?: string };
      err.ticket = token;
      throw err;
    }
    if (!seen.has(number)) {
      seen.add(number);
      out.push(number);
    }
  }
  return out;
}

/**
 * Render a `--ticket` validation error for the operator: the static `message`
 * plus any attached context (offending ticket / configured team), so the CLI
 * line is both searchable and actionable.
 */
export function formatTicketError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { ticket?: string; team?: string; value?: string };
  const detail = e.ticket ?? e.value;
  const parts: string[] = [];
  if (detail) parts.push(`ticket: ${detail}`);
  if (e.team) parts.push(`configured team: ${e.team}`);
  return parts.length > 0 ? `${e.message} (${parts.join(", ")})` : e.message;
}
