import { z } from "zod";

/** Reasoning-effort levels accepted by `claude --effort`. Enum order is
 *  display order (cheapest first); there is deliberately no default — an unset
 *  effort omits the flag and lets the engine pick its own default. */
export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
