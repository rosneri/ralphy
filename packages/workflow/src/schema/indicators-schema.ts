import { z } from "zod";

import { MarkerSchema } from "./marker-schema";

export const SET_INDICATOR_KEYS = [
  "setInProgress",
  "setDone",
  "setPrReady",
  "setError",
  "clearApproved",
] as const;

export const GetIndicatorSchema = z.object({
  filter: z.array(MarkerSchema).default([]),
});

export const SetIndicatorSchema = z.union([z.array(MarkerSchema).min(1), MarkerSchema]);

export const IndicatorsSchema = z.preprocess(
  // Accept `indicators:` (bare) — YAML parses that as null — as an empty
  // map. Lets the default WORKFLOW.md leave the key open for inline edits.
  (v) => (v == null ? {} : v),
  z
    .object({
      getTodo: GetIndicatorSchema.optional(),
      getInProgress: GetIndicatorSchema.optional(),
      getAutoMerge: GetIndicatorSchema.optional(),
      getApproved: GetIndicatorSchema.optional(),
      getConfirmGate: GetIndicatorSchema.optional(),
      setInProgress: SetIndicatorSchema.optional(),
      setDone: SetIndicatorSchema.optional(),
      setPrReady: SetIndicatorSchema.optional(),
      setError: SetIndicatorSchema.optional(),
      setAwaitingConfirmation: SetIndicatorSchema.optional(),
      clearApproved: SetIndicatorSchema.optional(),
      clearAwaitingConfirmation: SetIndicatorSchema.optional(),
    })
    .superRefine((value, ctx) => {
      for (const key of ["clearApproved", "clearAwaitingConfirmation"] as const) {
        const clear = value[key];
        if (!clear) continue;
        const markers = Array.isArray(clear) ? clear : [clear];
        for (const m of markers) {
          if ("negate" in m && m.negate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a negated marker — negation is only meaningful in getX filters`,
            });
            break;
          }
          if (m.type === "comment") continue;
          if (m.type !== "label") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} markers must be label-typed (status removal is not supported)`,
            });
            break;
          }
        }
      }
      for (const key of SET_INDICATOR_KEYS) {
        const set = value[key];
        if (!set) continue;
        const markers = Array.isArray(set) ? set : [set];
        for (const m of markers) {
          if ("negate" in m && m.negate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a negated marker — negation is only meaningful in getX filters`,
            });
            break;
          }
          if (m.type === "comment") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} cannot use a 'comment' marker — comment markers are read-only and only valid in getX filters`,
            });
            break;
          }
        }
      }
    }),
);
