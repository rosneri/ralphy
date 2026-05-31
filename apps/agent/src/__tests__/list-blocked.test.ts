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
  function mapRelationsToIdentifiers(
    relations: {
      type: string;
      relatedIssue: { id: string; identifier: string; state: { type: string } };
    }[],
  ): string[] {
    const DONE_STATE_TYPES = new Set(["completed", "cancelled"]);
    return relations
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.identifier);
  }

  test("excludes completed blockers", () => {
    const relations = [
      {
        type: "blocked_by",
        relatedIssue: { id: "id1", identifier: "ENG-10", state: { type: "completed" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual([]);
  });

  test("excludes cancelled blockers", () => {
    const relations = [
      {
        type: "blocked_by",
        relatedIssue: { id: "id1", identifier: "ENG-10", state: { type: "cancelled" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual([]);
  });

  test("includes open (unstarted) blockers", () => {
    const relations = [
      {
        type: "blocked_by",
        relatedIssue: { id: "id1", identifier: "ENG-5", state: { type: "unstarted" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual(["ENG-5"]);
  });

  test("includes in-progress blockers", () => {
    const relations = [
      {
        type: "blocked_by",
        relatedIssue: { id: "id1", identifier: "ENG-7", state: { type: "started" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual(["ENG-7"]);
  });

  test("excludes non-blocked_by relation types", () => {
    const relations = [
      {
        type: "blocks",
        relatedIssue: { id: "id1", identifier: "ENG-99", state: { type: "unstarted" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual([]);
  });

  test("mixes open and done blockers — only open are returned", () => {
    const relations = [
      {
        type: "blocked_by",
        relatedIssue: { id: "id1", identifier: "ENG-1", state: { type: "completed" } },
      },
      {
        type: "blocked_by",
        relatedIssue: { id: "id2", identifier: "ENG-2", state: { type: "started" } },
      },
      {
        type: "blocked_by",
        relatedIssue: { id: "id3", identifier: "ENG-3", state: { type: "cancelled" } },
      },
    ];
    expect(mapRelationsToIdentifiers(relations)).toEqual(["ENG-2"]);
  });
});
