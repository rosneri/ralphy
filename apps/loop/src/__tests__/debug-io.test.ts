import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDebugIo } from "../debug-io";

// The real I/O boundary. File-backed helpers run against real temp files;
// the `gh`/`stat` spawns and the Linear `fetch` are stubbed — spawn results are
// produced by spawning real `printf`/`false` so the fakes are genuine,
// fully-typed `SyncSubprocess` values (no casts needed).

const realSpawnSync = Bun.spawnSync.bind(Bun);
const ok = (stdout: string) => realSpawnSync(["printf", "%s", stdout]);
const fail = () => realSpawnSync(["false"]);

let tmp = "";

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = "";
});

async function makeTmp(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "debug-io-"));
  return tmp;
}

describe("readOptionalText / pathExists", () => {
  test("readOptionalText returns contents, or null when missing", async () => {
    const dir = await makeTmp();
    const file = join(dir, "a.txt");
    await writeFile(file, "hello");
    expect(await defaultDebugIo.readOptionalText(file)).toBe("hello");
    expect(await defaultDebugIo.readOptionalText(join(dir, "nope.txt"))).toBeNull();
  });

  test("pathExists reflects the filesystem", async () => {
    const dir = await makeTmp();
    const file = join(dir, "b.txt");
    await writeFile(file, "x");
    expect(await defaultDebugIo.pathExists(file)).toBe(true);
    expect(await defaultDebugIo.pathExists(join(dir, "missing"))).toBe(false);
  });
});

describe("inspectBinary", () => {
  test("returns null when the binary is absent", async () => {
    const dir = await makeTmp();
    expect(await defaultDebugIo.inspectBinary(dir)).toBeNull();
  });

  test("parses the embedded version from a present binary", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, ".ralph", "bin"), { recursive: true });
    await writeFile(join(dir, ".ralph", "bin", "cli.js"), 'const VERSION = "3.4.5";');
    const info = await defaultDebugIo.inspectBinary(dir);
    expect(info?.path).toBe(join(dir, ".ralph", "bin", "cli.js"));
    expect(info?.embeddedVersion).toBe("3.4.5");
  });
});

describe("fetchLinearIssue", () => {
  const prevKey = process.env.LINEAR_API_KEY;
  afterEach(() => {
    if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = prevKey;
  });

  test("returns null with no API key", async () => {
    delete process.env.LINEAR_API_KEY;
    expect(await defaultDebugIo.fetchLinearIssue("COD-1")).toBeNull();
  });

  test("returns the first issue node on a successful query", async () => {
    process.env.LINEAR_API_KEY = "key";
    const issue = {
      identifier: "COD-1",
      title: "T",
      url: "u",
      state: { name: "Done", type: "completed" },
      labels: { nodes: [] },
    };
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { issues: { nodes: [issue] } } })),
    );
    expect(await defaultDebugIo.fetchLinearIssue("COD-1")).toEqual(issue);
    spy.mockRestore();
  });

  test("returns null when the fetch rejects", async () => {
    process.env.LINEAR_API_KEY = "key";
    const spy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await defaultDebugIo.fetchLinearIssue("COD-1")).toBeNull();
    spy.mockRestore();
  });
});

describe("fetchGithubPr / fetchMergeableNow", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  test("returns null when no PR is found", async () => {
    const route = (() => fail()) as typeof Bun.spawnSync;
    spyOn(Bun, "spawnSync").mockImplementation(route);
    expect(await defaultDebugIo.fetchGithubPr("my-change")).toBeNull();
  });

  test("assembles a PR with its checks", async () => {
    const pr = { number: 7, title: "T", url: "u", state: "OPEN", mergeable: "MERGEABLE" };
    const checks = [{ name: "ci", state: "COMPLETED", conclusion: "SUCCESS" }];
    const route = ((cmd: string[]) => {
      if (cmd[2] === "list") return ok(JSON.stringify([pr]));
      if (cmd[2] === "checks") return ok(JSON.stringify(checks));
      return fail();
    }) as typeof Bun.spawnSync;
    spyOn(Bun, "spawnSync").mockImplementation(route);

    const result = await defaultDebugIo.fetchGithubPr("my-change");
    expect(result?.number).toBe(7);
    expect(result?.checks).toEqual(checks);
  });

  test("returns null on unparseable gh output", async () => {
    const route = (() => ok("not json")) as typeof Bun.spawnSync;
    spyOn(Bun, "spawnSync").mockImplementation(route);
    expect(await defaultDebugIo.fetchGithubPr("my-change")).toBeNull();
  });

  test("fetchMergeableNow returns the trimmed state, or null on failure", () => {
    const okSpy = spyOn(Bun, "spawnSync").mockImplementation((() =>
      ok("MERGEABLE")) as typeof Bun.spawnSync);
    expect(defaultDebugIo.fetchMergeableNow("u")).toBe("MERGEABLE");
    okSpy.mockRestore();

    spyOn(Bun, "spawnSync").mockImplementation((() => fail()) as typeof Bun.spawnSync);
    expect(defaultDebugIo.fetchMergeableNow("u")).toBeNull();
  });
});

describe("defaultDebugIo wiring", () => {
  test("agentLogPath and linearApiKey read process state", () => {
    expect(typeof defaultDebugIo.agentLogPath()).toBe("string");
    const prev = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = "abc";
    expect(defaultDebugIo.linearApiKey()).toBe("abc");
    if (prev === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = prev;
  });

  test("out and errOut write through to the process streams", () => {
    const outSpy = spyOn(process.stdout, "write").mockReturnValue(true);
    const errSpy = spyOn(process.stderr, "write").mockReturnValue(true);
    defaultDebugIo.out("hello");
    defaultDebugIo.errOut("oops");
    expect(outSpy).toHaveBeenCalledWith("hello\n");
    expect(errSpy).toHaveBeenCalledWith("oops");
    outSpy.mockRestore();
    errSpy.mockRestore();
  });
});
