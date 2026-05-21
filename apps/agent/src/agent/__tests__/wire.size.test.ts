import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("wire.ts size invariant", () => {
  test("non-blank, non-comment line count is ≤ 500", async () => {
    const path = join(import.meta.dir, "..", "wire.ts");
    const text = await Bun.file(path).text();
    const lines = text.split("\n");
    let inBlock = false;
    let count = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "") continue;
      if (inBlock) {
        if (line.includes("*/")) inBlock = false;
        continue;
      }
      if (line.startsWith("/*")) {
        if (!line.includes("*/")) inBlock = true;
        continue;
      }
      if (line.startsWith("//")) continue;
      count++;
    }
    expect(count).toBeLessThanOrEqual(500);
  });
});
