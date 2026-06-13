import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// RLF-257 size guard. post-task/index.ts is the orchestrator only — it wires
// the extracted phase modules (types, respawn, pr-create, pr-phase,
// conflict-fix-verify, validate-only, cleanup, teardown) together. It must NOT
// regrow back toward the 1395-LOC monolith this change decomposed. If a new
// concern needs > a few lines, extract it into its own post-task/ module
// instead of inlining it here. (Budget enforces structure, not coverage —
// never relax the coverage threshold to satisfy a refactor.)
const MAX_ORCHESTRATOR_LOC = 400;

describe("post-task orchestrator size budget", () => {
  test(`post-task/index.ts stays under ${MAX_ORCHESTRATOR_LOC} LOC`, async () => {
    const indexPath = join(import.meta.dirname, "..", "agent", "post-task", "index.ts");
    const source = await Bun.file(indexPath).text();
    const loc = source.split("\n").length;
    expect(loc).toBeLessThan(MAX_ORCHESTRATOR_LOC);
  });
});
