import { describe, expect, it } from "bun:test";
import { classifyCheck } from "../ci-classify";

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
