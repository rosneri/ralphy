import { describe, expect, test } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  test("basic case lowercases and hyphenates", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello, World!--  ")).toBe("hello-world");
  });
});
