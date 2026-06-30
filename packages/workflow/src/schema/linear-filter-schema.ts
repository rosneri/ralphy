import { z } from "zod";

import { FilterMarkerSchema } from "./marker-schema";

export const LinearFilterSchema = z
  .array(FilterMarkerSchema)
  .superRefine((markers, ctx) => {
    const assigneeCount = markers.filter((m) => m.type === "assignee").length;
    if (assigneeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `linear.filter allows at most one "assignee" clause, found ${assigneeCount}.`,
      });
    }
    const positiveProjects = markers.filter((m) => m.type === "project" && !m.negate).length;
    if (positiveProjects > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `linear.filter allows at most one positive "project" clause, found ${positiveProjects}.`,
      });
    }
  })
  .default([{ type: "assignee", value: "me" }]);
