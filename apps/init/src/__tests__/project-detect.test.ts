import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectCommandsFromPackageJson,
  detectFramework,
  detectInitialValues,
} from "../project-detect";

describe("detectCommandsFromPackageJson", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralphy-detect-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("maps known scripts to command fields with the bun run prefix", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest", lint: "eslint .", build: "tsc", typecheck: "tsc --noEmit" },
      }),
    );
    expect(await detectCommandsFromPackageJson(dir)).toEqual({
      "commands.test": "bun run test",
      "commands.lint": "bun run lint",
      "commands.build": "bun run build",
      "commands.typecheck": "bun run typecheck",
    });
  });

  test("uses the lockfile's package manager prefix", async () => {
    await Bun.write(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
    await Bun.write(join(dir, "package-lock.json"), "{}");
    expect(await detectCommandsFromPackageJson(dir)).toEqual({ "commands.lint": "npm run lint" });
  });

  test("accepts the type-check alias for typecheck", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { "type-check": "tsc --noEmit" } }),
    );
    expect(await detectCommandsFromPackageJson(dir)).toEqual({
      "commands.typecheck": "bun run type-check",
    });
  });

  test("returns nothing when there is no package.json", async () => {
    expect(await detectCommandsFromPackageJson(dir)).toEqual({});
  });
});

describe("detectFramework", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralphy-framework-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("combines runtime/tooling with the primary framework", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
    );
    await Bun.write(join(dir, "bun.lock"), "");
    await Bun.write(join(dir, "nx.json"), "{}");
    expect(await detectFramework(dir)).toBe("Bun + Nx + Next.js");
  });

  test("picks a single primary framework from dependencies", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { "@nestjs/core": "10.0.0" } }),
    );
    expect(await detectFramework(dir)).toBe("NestJS");
  });

  test("returns undefined when nothing recognizable is present", async () => {
    await Bun.write(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "4" } }));
    expect(await detectFramework(dir)).toBeUndefined();
  });
});

describe("detectInitialValues", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralphy-initial-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("gathers commands and framework (branch detection is environment-dependent)", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint ." }, dependencies: { vue: "3" } }),
    );
    const values = await detectInitialValues(dir);
    expect(values["commands.lint"]).toBe("bun run lint");
    expect(values["project.framework"]).toBe("Vue");
  });
});
