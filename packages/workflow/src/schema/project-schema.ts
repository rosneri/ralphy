import { z } from "zod";

export const ProjectSchema = z
  .object({
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
  })
  .strict()
  .default({});
