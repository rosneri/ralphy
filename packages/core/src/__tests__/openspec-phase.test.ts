import { describe, expect, test } from "bun:test";
import { deriveOpenSpecPhase, isStubArtifact } from "../openspec-phase";

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
});
