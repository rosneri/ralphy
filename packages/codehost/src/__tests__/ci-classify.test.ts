import { describe, expect, it } from "bun:test";
import { classifyCheck, reduceToBucket } from "../ci-classify";

describe("classifyCheck", () => {
  describe("GitHub Actions checks", () => {
    it("returns pending for IN_PROGRESS", () => {
      expect(classifyCheck({ status: "IN_PROGRESS" })).toBe("pending");
    });
    it("returns pending for QUEUED", () => {
      expect(classifyCheck({ status: "QUEUED" })).toBe("pending");
    });
    it("returns pending for WAITING", () => {
      expect(classifyCheck({ status: "WAITING" })).toBe("pending");
    });

    it("returns pass for COMPLETED+SUCCESS", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "SUCCESS" })).toBe("pass");
    });
    it("returns pass for COMPLETED+NEUTRAL", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "NEUTRAL" })).toBe("pass");
    });

    it("returns skip for COMPLETED+SKIPPED", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "SKIPPED" })).toBe("skip");
    });

    it("returns fail for COMPLETED+FAILURE", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "FAILURE" })).toBe("fail");
    });
    it("returns fail for COMPLETED+TIMED_OUT", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "TIMED_OUT" })).toBe("fail");
    });
    it("returns fail for COMPLETED+CANCELLED", () => {
      expect(classifyCheck({ status: "COMPLETED", conclusion: "CANCELLED" })).toBe("fail");
    });
  });

  describe("legacy commit statuses", () => {
    it("returns pending for PENDING state", () => {
      expect(classifyCheck({ state: "PENDING" })).toBe("pending");
    });
    it("returns pending for EXPECTED state", () => {
      expect(classifyCheck({ state: "EXPECTED" })).toBe("pending");
    });

    it("returns pass for SUCCESS state", () => {
      expect(classifyCheck({ state: "SUCCESS" })).toBe("pass");
    });

    it("returns fail for FAILURE state", () => {
      expect(classifyCheck({ state: "FAILURE" })).toBe("fail");
    });
    it("returns fail for ERROR state", () => {
      expect(classifyCheck({ state: "ERROR" })).toBe("fail");
    });
  });
});

describe("reduceToBucket", () => {
  it("returns pass when every check passed", () => {
    expect(reduceToBucket(["pass", "pass", "pass"])).toBe("pass");
  });

  it("returns fail when all settled and at least one failed", () => {
    expect(reduceToBucket(["pass", "fail", "pass"])).toBe("fail");
  });

  it("returns pending when any check is still pending — even alongside a failure", () => {
    expect(reduceToBucket(["pass", "fail", "pending"])).toBe("pending");
  });

  it("drops skipped checks — a skipped failure-free set is a pass", () => {
    expect(reduceToBucket(["pass", "skip", "pass"])).toBe("pass");
  });

  it("treats an all-skipped set as a pass (skips never gate a merge)", () => {
    expect(reduceToBucket(["skip", "skip"])).toBe("pass");
  });

  it("ignores skipped checks when deciding fail", () => {
    expect(reduceToBucket(["skip", "fail"])).toBe("fail");
  });

  it("returns pass for an empty set (all checks ignored/none reported)", () => {
    expect(reduceToBucket([])).toBe("pass");
  });

  it("composes with classifyCheck over a rollup-shaped fixture", () => {
    const rollup = [
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "SKIPPED" },
      { status: "IN_PROGRESS" },
    ];
    expect(reduceToBucket(rollup.map(classifyCheck))).toBe("pending");
  });
});
