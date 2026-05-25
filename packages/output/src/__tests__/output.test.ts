import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { styled, log, error, blank, separator, kv } from "../output";
import type { Style, StyledText } from "../output";

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("styled", () => {
  test("returns a formatted string for each style", () => {
    const styles: Style[] = [
      "bold",
      "dim",
      "gray",
      "error",
      "fail",
      "warn",
      "header",
      "success",
      "successBold",
      "cyan",
    ];

    for (const style of styles) {
      const result = styled("hello", style);
      expect(typeof result).toBe("string");
      // chalk wraps text with ANSI codes, so it should contain the original text
      expect(result).toContain("hello");
    }
  });
});

describe("log", () => {
  test("logs a plain string", () => {
    log("plain message");
    expect(logSpy).toHaveBeenCalledWith("plain message");
  });

  test("logs a StyledText object with formatting", () => {
    const msg: StyledText = { text: "styled message", style: "bold" };
    log(msg);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]![0] as string;
    expect(arg).toContain("styled message");
  });
});

describe("error", () => {
  test("logs a plain string to stderr", () => {
    error("error message");
    expect(errorSpy).toHaveBeenCalledWith("error message");
  });

  test("logs a StyledText object to stderr", () => {
    const msg: StyledText = { text: "error styled", style: "error" };
    error(msg);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const arg = errorSpy.mock.calls[0]![0] as string;
    expect(arg).toContain("error styled");
  });
});

describe("blank", () => {
  test("prints an empty line", () => {
    blank();
    expect(logSpy).toHaveBeenCalledWith("");
  });
});

describe("separator", () => {
  test("prints a separator line with default width", () => {
    separator();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]![0] as string;
    // The separator uses the "━" character repeated
    expect(arg).toContain("\u2501");
  });

  test("prints a separator line with custom width", () => {
    separator(10);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("kv", () => {
  test("prints a key-value pair", () => {
    kv("Name", "Ralph");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]![0] as string;
    expect(arg).toContain("Name:");
    expect(arg).toContain("Ralph");
  });

  test("pads with custom width", () => {
    kv("Key", "Value", 20);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
