/**
 * Confined Zod schema introspection for `WorkflowConfigSchema`.
 *
 * This is the ONLY module allowed to reach into Zod wrapper mechanics — every
 * other consumer (the wizard field catalogue, the CLI option table, the
 * defaults-fill migration) asks questions through these helpers, so a Zod
 * upgrade that changes wrapper shapes breaks loudly here and in the invariant
 * test, not silently at twelve call sites.
 *
 * Written against zod v4: Default/Optional/Nullable/Readonly wrappers expose
 * `.unwrap()`, and `z.preprocess` produces a `ZodPipe` whose `.out` is the
 * wrapped schema.
 */
import { z } from "zod";
import { WorkflowConfigSchema, type WorkflowConfig } from "../schema";

/** The schema with every default applied — the canonical defaults tree. */
export function schemaDefaults(): WorkflowConfig {
  return WorkflowConfigSchema.parse({});
}

// zod v4 wrapper accessors (`unwrap()`, `.out`, `.element`) are typed against
// the core `$ZodType` base rather than the classic `ZodType` class, so the
// traversal works at that level; `instanceof` narrows back to classic classes.
type AnySchema = z.core.$ZodType;

/** Strip Default/Optional/Nullable/Readonly/Pipe wrappers down to the core type. */
function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodDefault ||
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodReadonly
    ) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodPipe) {
      // `z.preprocess(fn, schema)` pipes a transform INTO the schema, so the
      // declared shape lives on the `out` side.
      current = current.out;
      continue;
    }
    return current;
  }
}

/** Resolve the sub-schema at a dotted config path, or null when none exists. */
function schemaAt(path: readonly string[]): AnySchema | null {
  let current: AnySchema = WorkflowConfigSchema;
  for (const segment of path) {
    const node = unwrap(current);
    if (!(node instanceof z.ZodObject)) return null;
    const shape: Record<string, AnySchema | undefined> = node.shape;
    const child = shape[segment];
    if (!child) return null;
    current = child;
  }
  return current;
}

/** Whether a dotted config path exists in the workflow schema. */
export function schemaHasPath(path: readonly string[]): boolean {
  return schemaAt(path) !== null;
}

/**
 * Enum values at a config path, unwrapping one array level so multiselect
 * fields (e.g. `linear.specAttachmentFormats`) resolve to their element enum.
 * Null when the path does not exist or is not enum-backed.
 */
export function enumValuesAt(path: readonly string[]): string[] | null {
  const found = schemaAt(path);
  if (!found) return null;
  let node = unwrap(found);
  if (node instanceof z.ZodArray) node = unwrap(node.element);
  if (node instanceof z.ZodEnum) {
    const values: string[] = [];
    for (const option of node.options) {
      if (typeof option === "string") values.push(option);
    }
    return values;
  }
  return null;
}
