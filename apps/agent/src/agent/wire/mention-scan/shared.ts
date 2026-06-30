/** Newest of a set of ISO timestamps (nulls ignored), or null when all null. */
export function latestIso(...values: (string | null)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

/** Linear/GitHub reject a duplicate reaction ("conflict on insert of Reaction"
 *  / "already exists"). That is not a failure — the comment is already marked
 *  seen — so the scan treats it as idempotent success instead of logging it
 *  every poll. */
export function isAlreadyReactedError(err: unknown): boolean {
  const e = err as { messages?: string[]; message?: string };
  const text = [...(e?.messages ?? []), e?.message ?? ""].join(" ").toLowerCase();
  return (
    text.includes("conflict on insert of reaction") ||
    text.includes("already exists") ||
    text.includes("already reacted")
  );
}
