import { describe, expect, it } from "bun:test";
import { dispositionFromExitCode } from "../disposition";

describe("dispositionFromExitCode", () => {
  it("maps 0 to done", () => {
    expect(dispositionFromExitCode(0)).toBe("done");
  });

  it("maps 72 to no-changes", () => {
    expect(dispositionFromExitCode(72)).toBe("no-changes");
  });

  it("maps 70 to ci-failed", () => {
    expect(dispositionFromExitCode(70)).toBe("ci-failed");
  });

  it("maps 71 to pr-failed", () => {
    expect(dispositionFromExitCode(71)).toBe("pr-failed");
  });

  it("maps any other non-zero code to error", () => {
    expect(dispositionFromExitCode(1)).toBe("error");
    expect(dispositionFromExitCode(2)).toBe("error");
    expect(dispositionFromExitCode(73)).toBe("error");
    expect(dispositionFromExitCode(255)).toBe("error");
  });
});
