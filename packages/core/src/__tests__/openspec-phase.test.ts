import { describe, expect, test } from "bun:test";
import {
  deriveOpenSpecPhase,
  isStubArtifact,
  phasePipeline,
  PIPELINE_PHASES,
  shouldShowPhasePipeline,
  shouldShowProgressBar,
  shouldShowSubtasksPanel,
} from "../openspec/phase";
import type { OpenSpecPhase } from "../openspec/phase";

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
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [x] Done one\n- [x] Done two\n",
      }),
    ).toBe("done");
  });

  test("proposal when proposal.md is a stub even if tasks have unchecked items", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\n_Fill in._",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [ ] Do thing\n",
      }),
    ).toBe("proposal");
  });

  test("design when proposal is filled but design is a stub", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\n_Fill in the technical design as you work through the issue._",
        tasks: "# Tasks\n\n- [ ] Do thing\n",
      }),
    ).toBe("design");
  });

  test("implement when proposal+design filled and tasks have unchecked items", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [x] Done\n- [ ] Pending\n",
      }),
    ).toBe("implement");
  });

  test("tasks when proposal+design filled but tasks.md is missing", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: null,
      }),
    ).toBe("tasks");
  });

  test("proposal when every artifact is missing", () => {
    expect(deriveOpenSpecPhase({ proposal: null, design: null, tasks: null })).toBe("proposal");
  });

  test("awaiting-confirmation when gated and not yet approved", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [ ] Pending\n",
        confirmationGated: true,
        approved: false,
      }),
    ).toBe("awaiting-confirmation");
  });

  test("implement when gated but approved", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [ ] Pending\n",
        confirmationGated: true,
        approved: true,
      }),
    ).toBe("implement");
  });

  test("implement when ungated regardless of approved flag (no regression)", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [ ] Pending\n",
        confirmationGated: false,
        approved: false,
      }),
    ).toBe("implement");
  });

  test("done wins over awaiting-confirmation even when gated", () => {
    expect(
      deriveOpenSpecPhase({
        proposal: "# Proposal\n\nReal description.",
        design: "# Design\n\nReal design.",
        tasks: "# Tasks\n\n- [x] Done one\n- [x] Done two\n",
        confirmationGated: true,
        approved: false,
      }),
    ).toBe("done");
  });
});

describe("PIPELINE_PHASES", () => {
  test("contains the expected ordered phases", () => {
    expect([...PIPELINE_PHASES]).toEqual([
      "proposal",
      "design",
      "tasks",
      "awaiting-confirmation",
      "implement",
    ]);
  });

  test("awaiting-confirmation sits between tasks and implement", () => {
    const tasksIdx = PIPELINE_PHASES.indexOf("tasks");
    const awaitingIdx = PIPELINE_PHASES.indexOf("awaiting-confirmation");
    const implementIdx = PIPELINE_PHASES.indexOf("implement");
    expect(awaitingIdx).toBe(tasksIdx + 1);
    expect(implementIdx).toBe(awaitingIdx + 1);
  });
});

describe("phasePipeline", () => {
  test("proposal → first segment current, rest pending", () => {
    expect(phasePipeline("proposal")).toEqual([
      { phase: "proposal", label: "proposal", status: "current" },
      { phase: "design", label: "design", status: "pending" },
      { phase: "tasks", label: "tasks", status: "pending" },
      { phase: "awaiting-confirmation", label: "awaiting-confirmation", status: "pending" },
      { phase: "implement", label: "implement", status: "pending" },
    ]);
  });

  test("design → proposal done, design current, rest pending", () => {
    expect(phasePipeline("design")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "current" },
      { phase: "tasks", label: "tasks", status: "pending" },
      { phase: "awaiting-confirmation", label: "awaiting-confirmation", status: "pending" },
      { phase: "implement", label: "implement", status: "pending" },
    ]);
  });

  test("tasks → proposal+design done, tasks current, implement pending", () => {
    expect(phasePipeline("tasks")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "current" },
      { phase: "awaiting-confirmation", label: "awaiting-confirmation", status: "pending" },
      { phase: "implement", label: "implement", status: "pending" },
    ]);
  });

  test("implement → first four done, implement current", () => {
    expect(phasePipeline("implement")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "done" },
      { phase: "awaiting-confirmation", label: "awaiting-confirmation", status: "done" },
      { phase: "implement", label: "implement", status: "current" },
    ]);
  });

  test("done → all five segments marked done", () => {
    expect(phasePipeline("done")).toEqual([
      { phase: "proposal", label: "proposal", status: "done" },
      { phase: "design", label: "design", status: "done" },
      { phase: "tasks", label: "tasks", status: "done" },
      { phase: "awaiting-confirmation", label: "awaiting-confirmation", status: "done" },
      { phase: "implement", label: "implement", status: "done" },
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
