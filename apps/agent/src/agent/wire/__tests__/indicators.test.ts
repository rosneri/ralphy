import type { Indicators } from "@ralphy/types";
import { describe, expect, it } from "bun:test";
import { describeIndicators } from "../indicators";

describe("describeIndicators — requireAllLabels clause", () => {
  const indicators: Indicators = {
    getTodo: { filter: [{ type: "label", value: "todo" }] },
  };

  it("renders a single label after assignee, before indicator clauses", () => {
    const out = describeIndicators(indicators, "ENG", "me", false, ["bug"]);
    expect(out).toBe("team=ENG, assignee=me, labels=[bug], todo=[label:todo]");
  });

  it("renders multiple labels comma-joined, order preserved", () => {
    const out = describeIndicators(indicators, "ENG", "me", false, ["bug", "p1", "frontend"]);
    expect(out).toBe("team=ENG, assignee=me, labels=[bug,p1,frontend], todo=[label:todo]");
  });

  it("omits the labels clause entirely when the list is empty", () => {
    const out = describeIndicators(indicators, "ENG", "me", false, []);
    expect(out).toBe("team=ENG, assignee=me, todo=[label:todo]");
  });

  it("omits the labels clause when requireAllLabels is undefined", () => {
    const out = describeIndicators(indicators, "ENG", "me", false);
    expect(out).toBe("team=ENG, assignee=me, todo=[label:todo]");
  });

  it("preserves team and assignee alongside labels", () => {
    const out = describeIndicators({}, "ENG", "alice", false, ["bug"]);
    expect(out).toBe("team=ENG, assignee=alice, labels=[bug]");
  });

  it("preserves team and anyAssignee alongside labels", () => {
    const out = describeIndicators({}, "ENG", undefined, true, ["bug"]);
    expect(out).toBe("team=ENG, assignee=any, labels=[bug]");
  });
});
