import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";

/**
 * Resolve the effective Indicators map: CLI overrides replace config keys
 * one-by-one. Repeated CLI flags for the same key collapse into a `Marker[]`.
 * CLI is authoritative when present. Strips `undefined`
 * values from the merged record (exactOptionalPropertyTypes).
 */
export function mergeIndicators(
  cfg: Record<string, unknown>,
  cli: Partial<Indicators>,
): Indicators {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(cli)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Indicators;
}

/** Build a flat marker list across many SetIndicators (used for exclusion). */
export function unionMarkers(...sets: (SetIndicator | undefined)[]): Marker[] {
  const out: Marker[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    if (!s) continue;
    for (const m of markersOf(s)) {
      const key = `${m.type}:${m.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

export function describeIndicators(
  indicators: Indicators,
  team: string | undefined,
  assignee: string | undefined,
  anyAssignee?: boolean,
): string {
  const parts: string[] = [];
  parts.push(`team=${team ?? "*"}`);
  parts.push(`assignee=${anyAssignee ? "any" : (assignee ?? "*")}`);
  if (indicators.getTodo) {
    parts.push(`todo=[${indicators.getTodo.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`);
  }
  if (indicators.getInProgress) {
    parts.push(
      `inProgress=[${indicators.getInProgress.filter.map((m) => `${m.type}:${m.value}`).join(",")}]`,
    );
  }
  return parts.join(", ");
}
