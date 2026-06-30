import { z } from "zod";

/** Default for the in-loop structural gate (`commands.structure`). Single-sourced
 *  so the field default and the CommandsSchema container default stay in lockstep. */
export const DEFAULT_STRUCTURE_COMMAND = "bun run check:structure";

export const CommandsSchema = z
  .object({
    test: z.string().optional(),
    lint: z.string().optional(),
    build: z.string().optional(),
    typecheck: z.string().optional(),
    /** In-loop structural gate run alongside test/lint/typecheck in the
     *  validate-only phase. Defaults on (`bun run check:structure`) so the
     *  Ralph loop enforces the project's own structure guardrails each
     *  iteration; set it to "" in WORKFLOW.md to opt a project out. */
    structure: z.string().default(DEFAULT_STRUCTURE_COMMAND),
  })
  .catchall(z.string())
  .default({ structure: DEFAULT_STRUCTURE_COMMAND });
