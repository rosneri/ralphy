import { describe, expect, test } from "bun:test";
import { formatBlockedCell } from "../list";

describe("formatBlockedCell", () => {
  test("renders '-' for unblocked rows", () => {
    expect(formatBlockedCell([])).toBe("-");
  });

  test("renders single identifier for single blocker", () => {
    expect(formatBlockedCell(["ENG-42"])).toBe("ENG-42");
  });

  test("renders comma-separated identifiers for multiple blockers", () => {
    expect(formatBlockedCell(["ENG-1", "ENG-2"])).toBe("ENG-1, ENG-2");
  });
});

describe("blockedByIdentifiers mapping", () => {
  // Mirrors the production mapping in linear-client (`openBlockersFromInverse`):
  // Linear has no `blocked_by` relation type — a "blocked by" link surfaces in
  // `inverseRelations` as a `blocks` relation whose `issue` is the blocker.
  function mapInverseRelationsToIdentifiers(
    nodes: {
      type: string;
      issue: { id: string; identifier: string; state: { type: string } };
    }[],
  ): string[] {
    const DONE_STATE_TYPES = new Set(["completed", "cancelled"]);
    return nodes
      .filter((r) => r.type === "blocks" && !DONE_STATE_TYPES.has(r.issue.state.type))
      .map((r) => r.issue.identifier);
  }

  test("excludes completed blockers", () => {
    const nodes = [
      { type: "blocks", issue: { id: "id1", identifier: "ENG-10", state: { type: "completed" } } },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual([]);
  });

  test("excludes cancelled blockers", () => {
    const nodes = [
      { type: "blocks", issue: { id: "id1", identifier: "ENG-10", state: { type: "cancelled" } } },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual([]);
  });

  test("includes open (unstarted) blockers", () => {
    const nodes = [
      { type: "blocks", issue: { id: "id1", identifier: "ENG-5", state: { type: "unstarted" } } },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual(["ENG-5"]);
  });

  test("includes in-progress blockers", () => {
    const nodes = [
      { type: "blocks", issue: { id: "id1", identifier: "ENG-7", state: { type: "started" } } },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual(["ENG-7"]);
  });

  test("excludes non-blocks inverse-relation types", () => {
    const nodes = [
      {
        type: "duplicate",
        issue: { id: "id1", identifier: "ENG-99", state: { type: "unstarted" } },
      },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual([]);
  });

  test("mixes open and done blockers — only open are returned", () => {
    const nodes = [
      { type: "blocks", issue: { id: "id1", identifier: "ENG-1", state: { type: "completed" } } },
      { type: "blocks", issue: { id: "id2", identifier: "ENG-2", state: { type: "started" } } },
      { type: "blocks", issue: { id: "id3", identifier: "ENG-3", state: { type: "cancelled" } } },
    ];
    expect(mapInverseRelationsToIdentifiers(nodes)).toEqual(["ENG-2"]);
  });
});
