import { describe, expect, it } from "bun:test";

/**
 * This package is published to npm as `@neriros/ralphy-types` (see the publish
 * step in .github/workflows/publish.yml). Anything that would make the published
 * tarball unusable outside the monorepo — a `@ralphy/*` workspace dependency, an
 * undeclared runtime dependency, a missing `files` entry — has to fail here,
 * because it otherwise only shows up after a release.
 */
describe("publish manifest", () => {
  const manifestPath = new URL("../../package.json", import.meta.url);

  it("declares zod and no workspace dependencies", async () => {
    const manifest = await Bun.file(manifestPath).json();

    expect(manifest.dependencies).toEqual({ zod: expect.stringMatching(/^\^?3\./) });
  });

  it("ships the sources the contract lives in, without the tests", async () => {
    const manifest = await Bun.file(manifestPath).json();

    expect(manifest.files).toEqual(["src", "!src/__tests__", "README.md"]);
    expect(manifest.exports).toEqual({ ".": "./src/types.ts" });
  });

  it("keeps the internal name and stays private in git", async () => {
    const manifest = await Bun.file(manifestPath).json();

    // The published name/version/private:false are set transiently by the
    // publish job, so git must still show the workspace identity — the
    // @ralphy/*-scoped structure checks key on it.
    expect(manifest.name).toBe("@ralphy/types");
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toEqual({ access: "public" });
  });
});
