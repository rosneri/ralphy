import { describe, expect, test } from "bun:test";
import {
  countOpenFindings,
  deriveOpenSpecPhase,
  isStubArtifact,
  phasePipeline,
  PIPELINE_PHASES,
  shouldShowPhasePipeline,
  shouldShowProgressBar,
  shouldShowSubtasksPanel,
} from "../openspec/phase";
import type { OpenSpecPhase } from "../openspec/phase";

/** Minimal inputs helper — omits review fields (disabled). */
function noReview(proposal: string | null, design: string | null, tasks: string | null) {
  return { proposal, design, tasks, reviewFindings: null, reviewRounds: 0, maxReviewRounds: 0 };
}

describe("isStubArtifact", () => {
  test("null is a stub", () => {
    expect(isStubArtifact(null)).toBe(true);
  });

  test("empty string is a stub", () => {
    expect(isStubArtifact("")).toBe(true);
  });

  test("headings only is a stub", () => {
    expect(isStubArtifact("# Title\n\n## Section\n")).toBe(true);
  });

  test("italic placeholder is a stub", () => {
    expect(
      isStubArtifact("# Design\n\n_Fill in the technical design as you work through the issue._\n"),
    ).toBe(true);
  });

  test("real prose is not a stub", () => {
    expect(isStubArtifact("# Design\n\nWe will use a derivation function in @ralphy/core.\n")).toBe(
      false,
    );
  });

  test("checklist content is not a stub", () => {
    expect(isStubArtifact("# Tasks\n\n- [ ] Do the thing\n")).toBe(false);
  });
});

describe("deriveOpenSpecPhase", () => {
  test("done when tasks.md has no unchecked items", () => {
    expect(
      deriveOpenSpecPhase(
        noReview(
          "# Proposal\n\nReal description.",
          "# Design\n\nReal design.",
          "# Tasks\n\n- [x] Done one\n- [x] Done two\n",
        ),
      ),
    ).toBe("done");
  });

  test("proposal when proposal.md is a stub even if tasks have unchecked items", () => {
    expect(
      deriveOpenSpecPhase(
        noReview(
          "# Proposal\n\n_Fill in._",
          "# Design\n\nReal design.",
          "# Tasks\n\n- [ ] Do thing\n",
        ),
      ),
    ).toBe("proposal");
  });

  test("design when proposal is filled but design is a stub", () => {
    expect(
      deriveOpenSpecPhase(
        noReview(
          "# Proposal\n\nReal description.",
          "# Design\n\n_Fill in the technical design as you work through the issue._",
          "# Tasks\n\n- [ ] Do thing\n",
        ),
      ),
    ).toBe("design");
  });

  test("implement when proposal+design filled and tasks have unchecked items", () => {
    expect(
      deriveOpenSpecPhase(
        noReview(
          "# Proposal\n\nReal description.",
          "# Design\n\nReal design.",
          "# Tasks\n\n- [x] Done\n- [ ] Pending\n",
        ),
      ),
    ).toBe("implement");
  });

  test("tasks when proposal+design filled but tasks.md is missing", () => {
    expect(
      deriveOpenSpecPhase(
        noReview("# Proposal\n\nReal description.", "# Design\n\nReal design.", null),
      ),
    ).toBe("tasks");
  });

  test("proposal when every artifact is missing", () => {
    expect(deriveOpenSpecPhase(noReview(null, null, null))).toBe("proposal");
  });

  test("done wins regardless of gate state (now decoupled)", () => {
    expect(
      deriveOpenSpecPhase(
        noReview(
          "# Proposal\n\nReal description.",
          "# Design\n\nReal design.",
          "# Tasks\n\n- [x] Done one\n- [x] Done two\n",
        ),
      ),
    ).toBe("done");
  });

  // --- Review phase (enabled-only) ---

  const DONE_TASKS = "# Tasks\n\n- [x] Done one\n- [x] Done two\n";
  const PROPOSAL = "# Proposal\n\nReal description.";
  const DESIGN = "# Design\n\nReal design.";

  test("review: no findings → done (review enabled, no review run yet triggers review phase)", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: PROPOSAL,
        design: DESIGN,
        tasks: DONE_TASKS,
        reviewFindings: null,
        reviewRounds: 0,
        maxReviewRounds: 1,
      }),
    ).toBe("review");
  });

  test("review: open findings + under cap → design (loop back)", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: PROPOSAL,
        design: DESIGN,
        tasks: DONE_TASKS,
        reviewFindings: "## Open\n\n- [ ] Fix the thing\n",
        reviewRounds: 0,
        maxReviewRounds: 2,
      }),
    ).toBe("design");
  });

  test("review: open findings at cap → done (cap enforcement)", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: PROPOSAL,
        design: DESIGN,
        tasks: DONE_TASKS,
        reviewFindings: "## Open\n\n- [ ] Fix the thing\n",
        reviewRounds: 2,
        maxReviewRounds: 2,
      }),
    ).toBe("done");
  });

  test("review: no open findings after review → done (clean pass)", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: PROPOSAL,
        design: DESIGN,
        tasks: DONE_TASKS,
        reviewFindings: "## Open\n\n(no findings — close round)\n",
        reviewRounds: 1,
        maxReviewRounds: 2,
      }),
    ).toBe("done");
  });

  test("review: disabled (maxReviewRounds=0) → done regardless of findings", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: PROPOSAL,
        design: DESIGN,
        tasks: DONE_TASKS,
        reviewFindings: "## Open\n\n- [ ] Fix the thing\n",
        reviewRounds: 0,
        maxReviewRounds: 0,
      }),
    ).toBe("done");
  });
});

describe("PIPELINE_PHASES", () => {
  test("contains the expected ordered phases including review", () => {
    expect([...PIPELINE_PHASES]).toEqual(["proposal", "design", "tasks", "implement", "review"]);
  });
});

describe("phasePipeline", () => {
  test("proposal → first segment current, rest pending", () => {
    expect(phasePipeline("proposal")).toEqual([
      { phase: "proposal", label: "proposal", status: "current" },
      { phase: "design", label: "design", status: "pending" },
      { phase: "tasks", label: "tasks", status: "pending" },
      { phase: "implement", label: "implement", status: "pending" },
      { phase: "review", label: "review", status: "pending" },
    ]);
  });

  test("design → proposal done, design current, rest pending", () => {
    expect(phasePipeline("design")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "current" },
      { phase: "tasks", label: "tasks", status: "pending" },
      { phase: "implement", label: "implement", status: "pending" },
      { phase: "review", label: "review", status: "pending" },
    ]);
  });

  test("tasks → proposal+design done, tasks current, implement+review pending", () => {
    expect(phasePipeline("tasks")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "current" },
      { phase: "implement", label: "implement", status: "pending" },
      { phase: "review", label: "review", status: "pending" },
    ]);
  });

  test("implement → first three done, implement current, review pending", () => {
    expect(phasePipeline("implement")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "done" },
      { phase: "implement", label: "implement", status: "current" },
      { phase: "review", label: "review", status: "pending" },
    ]);
  });

  test("done → all five segments marked done", () => {
    expect(phasePipeline("done")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "done" },
      { phase: "implement", label: "implement", status: "done" },
      { phase: "review", label: "review", status: "done" },
    ]);
  });

  test("review → first four done, review current", () => {
    expect(phasePipeline("review")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "done" },
      { phase: "implement", label: "implement", status: "done" },
      { phase: "review", label: "review", status: "current" },
    ]);
  });
});

describe("phase-gating predicates", () => {
  const rows: Array<{
    phase: OpenSpecPhase | undefined;
    pipeline: boolean;
    subtasksWhenOn: boolean;
    progressWhenOff: boolean;
  }> = [
    { phase: undefined, pipeline: false, subtasksWhenOn: true, progressWhenOff: true },
    { phase: "proposal", pipeline: true, subtasksWhenOn: false, progressWhenOff: false },
    { phase: "design", pipeline: true, subtasksWhenOn: false, progressWhenOff: false },
    { phase: "tasks", pipeline: true, subtasksWhenOn: false, progressWhenOff: false },
    { phase: "implement", pipeline: false, subtasksWhenOn: true, progressWhenOff: true },
    { phase: "review", pipeline: true, subtasksWhenOn: false, progressWhenOff: false },
    { phase: "done", pipeline: false, subtasksWhenOn: true, progressWhenOff: true },
  ];

  for (const row of rows) {
    const tag = row.phase ?? "undefined";

    test(`shouldShowPhasePipeline(${tag}) → ${row.pipeline}`, () => {
      expect(shouldShowPhasePipeline(row.phase)).toBe(row.pipeline);
    });

    test(`shouldShowSubtasksPanel(${tag}, true, true) → ${row.subtasksWhenOn}`, () => {
      expect(shouldShowSubtasksPanel(row.phase, true, true)).toBe(row.subtasksWhenOn);
    });

    test(`shouldShowSubtasksPanel(${tag}, false, true) → false (toggle off)`, () => {
      expect(shouldShowSubtasksPanel(row.phase, false, true)).toBe(false);
    });

    test(`shouldShowSubtasksPanel(${tag}, true, false) → false (no subtasks)`, () => {
      expect(shouldShowSubtasksPanel(row.phase, true, false)).toBe(false);
    });

    test(`shouldShowProgressBar(${tag}, false, true) → ${row.progressWhenOff}`, () => {
      expect(shouldShowProgressBar(row.phase, false, true)).toBe(row.progressWhenOff);
    });

    test(`shouldShowProgressBar(${tag}, true, true) → false (toggle on)`, () => {
      expect(shouldShowProgressBar(row.phase, true, true)).toBe(false);
    });

    test(`shouldShowProgressBar(${tag}, false, false) → false (no progress)`, () => {
      expect(shouldShowProgressBar(row.phase, false, false)).toBe(false);
    });
  }
});

describe("countOpenFindings", () => {
  test("empty content → 0", () => {
    expect(countOpenFindings("")).toBe(0);
  });

  test("no ## Open section → 0", () => {
    expect(countOpenFindings("## Resolved\n\n- [ ] item\n")).toBe(0);
  });

  test("## Open with one unchecked item → 1", () => {
    expect(countOpenFindings("## Open\n\n- [ ] Fix the thing\n")).toBe(1);
  });

  test("## Open with multiple unchecked items → correct count", () => {
    expect(countOpenFindings("## Open\n\n- [ ] Fix one\n- [ ] Fix two\n- [ ] Fix three\n")).toBe(3);
  });

  test("checked items under ## Open are not counted", () => {
    expect(countOpenFindings("## Open\n\n- [x] Already fixed\n- [ ] Still open\n")).toBe(1);
  });

  test("items under other headings are not counted", () => {
    const content = [
      "## Open",
      "",
      "- [ ] Real finding",
      "",
      "## Resolved",
      "",
      "- [ ] This was resolved",
    ].join("\n");
    expect(countOpenFindings(content)).toBe(1);
  });

  test("(no findings — close round) text → 0", () => {
    expect(countOpenFindings("## Open\n\n(no findings — close round)\n")).toBe(0);
  });

  test("case-insensitive ## Open heading match", () => {
    expect(countOpenFindings("## OPEN\n\n- [ ] Item\n")).toBe(1);
  });
});
