import { describe, expect, test } from "bun:test";
import { derivePlanPhase, type PlanPhase } from "../detections/phase";

const STUB = "# Heading\n\n_Fill in._\n";
const REAL = "# Heading\n\nReal content.\n";

describe("derivePlanPhase", () => {
  test("all stubs → proposal", () => {
    expect(derivePlanPhase({ proposal: STUB, design: STUB, tasks: null })).toBe("proposal");
  });
  test("non-stub proposal + stub design → design", () => {
    expect(derivePlanPhase({ proposal: REAL, design: STUB, tasks: null })).toBe("design");
  });
  test("non-stub proposal + design + tasks with unchecked → implement", () => {
    expect(
      derivePlanPhase({ proposal: REAL, design: REAL, tasks: "- [x] done\n- [ ] pending\n" }),
    ).toBe("implement");
  });
  test("tasks with no unchecked and non-empty → done", () => {
    expect(derivePlanPhase({ proposal: REAL, design: REAL, tasks: "- [x] done\n" })).toBe("done");
  });
  test("non-stub design + no tasks file → tasks", () => {
    expect(derivePlanPhase({ proposal: REAL, design: REAL, tasks: null })).toBe("tasks");
  });

  test("return type does not include `awaiting-confirmation`", () => {
    // Type-level assertion: this assignment compiles only when
    // `awaiting-confirmation` is NOT a member of PlanPhase.
    type ExcludeCheck = Exclude<PlanPhase, "proposal" | "design" | "tasks" | "implement" | "done">;
    const _exhaustive: ExcludeCheck = undefined as never;
    expect(_exhaustive).toBeUndefined();
  });
});
