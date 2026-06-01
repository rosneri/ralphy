import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { parseRepoIdentity, detectRepoIdentity } from "../repo";

describe("parseRepoIdentity", () => {
  const cases: { input: string; owner: string; name: string; host: string }[] = [
    { input: "git@github.com:owner/name.git", host: "github.com", owner: "owner", name: "name" },
    { input: "git@github.com:owner/name", host: "github.com", owner: "owner", name: "name" },
    {
      input: "https://github.com/owner/name.git",
      host: "github.com",
      owner: "owner",
      name: "name",
    },
    { input: "https://github.com/owner/name", host: "github.com", owner: "owner", name: "name" },
    { input: "https://github.com/owner/name/", host: "github.com", owner: "owner", name: "name" },
    {
      input: "http://git.example.com/owner/name.git",
      host: "git.example.com",
      owner: "owner",
      name: "name",
    },
    {
      input: "https://user@github.com/owner/name.git",
      host: "github.com",
      owner: "owner",
      name: "name",
    },
    {
      input: "ssh://git@github.com:22/owner/name.git",
      host: "github.com",
      owner: "owner",
      name: "name",
    },
    {
      input: "ssh://git@host.example.com/owner/name.git",
      host: "host.example.com",
      owner: "owner",
      name: "name",
    },
    {
      // GitLab nested subgroups: owner keeps every segment but the last.
      input: "git@gitlab.com:group/subgroup/name.git",
      host: "gitlab.com",
      owner: "group/subgroup",
      name: "name",
    },
    {
      input: "https://gitlab.com/group/subgroup/deeper/name.git",
      host: "gitlab.com",
      owner: "group/subgroup/deeper",
      name: "name",
    },
  ];

  for (const { input, host, owner, name } of cases) {
    test(`parses ${input}`, () => {
      expect(parseRepoIdentity(input)).toEqual({ remote: input, host, owner, name });
    });
  }

  const garbage = [
    "",
    "   ",
    "not-a-url",
    "/local/path/to/repo",
    "../relative/repo",
    "file:///local/path/to/repo.git",
    "git@github.com:",
    "git@github.com:name",
    "https://github.com/",
    "https://github.com/onlyowner",
  ];
  for (const input of garbage) {
    test(`returns null for garbage: ${JSON.stringify(input)}`, () => {
      expect(parseRepoIdentity(input)).toBeNull();
    });
  }

  test("trims surrounding whitespace before parsing", () => {
    expect(parseRepoIdentity("  git@github.com:owner/name.git\n")).toEqual({
      remote: "git@github.com:owner/name.git",
      host: "github.com",
      owner: "owner",
      name: "name",
    });
  });
});

describe("detectRepoIdentity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "repo-detect-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function git(args: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  }

  test("returns the parsed identity for a repo with an origin remote", async () => {
    await git(["init"], tempDir);
    await git(["remote", "add", "origin", "git@github.com:acme/widgets.git"], tempDir);
    expect(await detectRepoIdentity(tempDir)).toEqual({
      remote: "git@github.com:acme/widgets.git",
      host: "github.com",
      owner: "acme",
      name: "widgets",
    });
  });

  test("returns null for a git repo with no origin remote", async () => {
    await git(["init"], tempDir);
    expect(await detectRepoIdentity(tempDir)).toBeNull();
  });

  test("returns null in a non-repo directory", async () => {
    expect(await detectRepoIdentity(tempDir)).toBeNull();
  });
});
