/**
 * Integration tests for the OpenSpec change store lifecycle — covers RLF-110 scenarios S9.1–S9.7.
 *
 * S9.1: listChanges with missing openspec/changes directory
 * S9.2: Empty files (tasks.md is empty)
 * S9.3: Stub/placeholder files — readTaskList and writeTaskList round-trip
 * S9.4: Unicode in change names
 * S9.5: Name collisions (prefix/suffix relationships between change names)
 * S9.6: writeTaskList creates parent directories if they do not exist
 * S9.7: archive directory excluded from listChanges results
 *
 * Bun.spawnSync is patched to return empty stdout so every method that shells out
 * to the openspec binary falls through to its filesystem-based fallback path.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Patch Bun.spawnSync before importing the store so spawn-dependent methods
// return empty output and fall through to their filesystem fallback paths.
Object.assign(Bun, {
  spawnSync: () => ({
    exitCode: 0,
    success: true,
    stdout: new TextEncoder().encode(""),
    stderr: new TextEncoder().encode(""),
    pid: 0,
    signalCode: null,
    resourceUsage: undefined,
  }),
});

const { OpenSpecChangeStore } = await import("../openspec-change-store");

let tempDir: string;
let originalCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "openspec-lifecycle-"));
  originalCwd = process.cwd();
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S9.1 — Missing openspec/changes directory
// ---------------------------------------------------------------------------

describe("S9.1 — missing openspec/changes directory", () => {
  test("listChanges returns empty array when the changes directory does not exist", async () => {
    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toEqual([]);
  });

  test("readTaskList returns empty string for a change whose directory has never been created", async () => {
    const store = new OpenSpecChangeStore();
    const content = await store.readTaskList("nonexistent-change");
    expect(content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// S9.2 — Empty files
// ---------------------------------------------------------------------------

describe("S9.2 — empty files", () => {
  test("readTaskList returns empty string when tasks.md exists but is empty", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "empty-change"), { recursive: true });
    writeFileSync(join(tempDir, "openspec", "changes", "empty-change", "tasks.md"), "");

    const store = new OpenSpecChangeStore();
    const content = await store.readTaskList("empty-change");
    expect(content).toBe("");
  });

  test("appendSteering on an empty tasks.md creates a well-formed Steering section", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "empty-change"), { recursive: true });
    writeFileSync(join(tempDir, "openspec", "changes", "empty-change", "tasks.md"), "");

    const store = new OpenSpecChangeStore();
    await store.appendSteering("empty-change", "First steering note");

    const content = await store.readTaskList("empty-change");
    expect(content).toContain("## Steering");
    expect(content).toContain("Address steering: First steering note");
  });

  test("listChanges includes a change directory that is empty (no task/proposal files)", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "hollow-change"), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toContain("hollow-change");
  });
});

// ---------------------------------------------------------------------------
// S9.3 — Stub/placeholder files
// ---------------------------------------------------------------------------

describe("S9.3 — stub/placeholder files", () => {
  test("readTaskList returns stub content unchanged", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "stub-change"), { recursive: true });
    const stub = "# Tasks for stub-change\n\n_Fill in tasks here._\n";
    writeFileSync(join(tempDir, "openspec", "changes", "stub-change", "tasks.md"), stub);

    const store = new OpenSpecChangeStore();
    const content = await store.readTaskList("stub-change");
    expect(content).toBe(stub);
  });

  test("writeTaskList then readTaskList round-trips multi-section content faithfully", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "round-trip"), { recursive: true });
    const content =
      "## Planning\n\n- [ ] Do the thing\n- [x] Done thing\n\n## Implementation\n\n- [ ] Build it\n";

    const store = new OpenSpecChangeStore();
    await store.writeTaskList("round-trip", content);
    const read = await store.readTaskList("round-trip");
    expect(read).toBe(content);
  });

  test("multiple appendSteering calls accumulate without duplicating the Steering section header", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "multi-steer"), { recursive: true });
    writeFileSync(
      join(tempDir, "openspec", "changes", "multi-steer", "tasks.md"),
      "## Planning\n\n- [x] plan\n",
    );

    const store = new OpenSpecChangeStore();
    await store.appendSteering("multi-steer", "first nudge");
    await store.appendSteering("multi-steer", "second nudge");

    const content = await store.readTaskList("multi-steer");
    expect(content.match(/## Steering/g)?.length).toBe(1);
    expect(content).toContain("first nudge");
    expect(content).toContain("second nudge");
  });
});

// ---------------------------------------------------------------------------
// S9.4 — Unicode in change names
// ---------------------------------------------------------------------------

describe("S9.4 — unicode in change names", () => {
  test("listChanges returns a change directory whose name contains unicode characters", async () => {
    const unicodeName = "rlf-110-tëst-ünïcödé-chängé";
    mkdirSync(join(tempDir, "openspec", "changes", unicodeName), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toContain(unicodeName);
  });

  test("readTaskList works with a unicode change name", async () => {
    const unicodeName = "rlf-110-café-☕";
    mkdirSync(join(tempDir, "openspec", "changes", unicodeName), { recursive: true });
    writeFileSync(
      join(tempDir, "openspec", "changes", unicodeName, "tasks.md"),
      "## Tasks\n\n- [ ] Unicode task: café ☕\n",
    );

    const store = new OpenSpecChangeStore();
    const content = await store.readTaskList(unicodeName);
    expect(content).toContain("café ☕");
  });

  test("writeTaskList and appendSteering work with unicode change names", async () => {
    const unicodeName = "rlf-110-日本語";
    mkdirSync(join(tempDir, "openspec", "changes", unicodeName), { recursive: true });

    const store = new OpenSpecChangeStore();
    await store.writeTaskList(unicodeName, "## Tasks\n\n- [ ] 日本語のタスク\n");
    await store.appendSteering(unicodeName, "Steering: 確認が必要");

    const content = await store.readTaskList(unicodeName);
    expect(content).toContain("日本語のタスク");
    expect(content).toContain("確認が必要");
  });
});

// ---------------------------------------------------------------------------
// S9.5 — Name collisions (prefix/suffix relationships)
// ---------------------------------------------------------------------------

describe("S9.5 — name collisions (prefix/suffix change names)", () => {
  test("listChanges returns both changes when one name is a prefix of the other", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "my-feature"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "my-feature-v2"), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toContain("my-feature");
    expect(changes).toContain("my-feature-v2");
    expect(changes).toHaveLength(2);
  });

  test("readTaskList reads from the correct change when names share a common prefix", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "rlf-1-short"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "rlf-10-longer"), { recursive: true });
    writeFileSync(
      join(tempDir, "openspec", "changes", "rlf-1-short", "tasks.md"),
      "content-for-short\n",
    );
    writeFileSync(
      join(tempDir, "openspec", "changes", "rlf-10-longer", "tasks.md"),
      "content-for-longer\n",
    );

    const store = new OpenSpecChangeStore();
    expect(await store.readTaskList("rlf-1-short")).toBe("content-for-short\n");
    expect(await store.readTaskList("rlf-10-longer")).toBe("content-for-longer\n");
  });
});

// ---------------------------------------------------------------------------
// S9.6 — writeTaskList creates parent directories
// ---------------------------------------------------------------------------

describe("S9.6 — writeTaskList creates parent directories if missing", () => {
  test("writeTaskList creates the change directory when it does not exist", async () => {
    const store = new OpenSpecChangeStore();
    await store.writeTaskList("brand-new-change", "## Tasks\n\n- [ ] first\n");
    const content = await store.readTaskList("brand-new-change");
    expect(content).toContain("first");
  });

  test("writeTaskList overwrites existing content", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "overwrite-me"), { recursive: true });
    writeFileSync(
      join(tempDir, "openspec", "changes", "overwrite-me", "tasks.md"),
      "old content\n",
    );

    const store = new OpenSpecChangeStore();
    await store.writeTaskList("overwrite-me", "new content\n");
    expect(await store.readTaskList("overwrite-me")).toBe("new content\n");
  });
});

// ---------------------------------------------------------------------------
// S9.7 — archive directory excluded from listChanges
// ---------------------------------------------------------------------------

describe("S9.7 — archive directory excluded from listChanges", () => {
  test("listChanges does not include 'archive' even when it is present", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "real-change"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "archive"), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toContain("real-change");
    expect(changes).not.toContain("archive");
  });

  test("listChanges does not surface archived changes nested under archive/", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "active-change"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "archive", "old-change"), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = await store.listChanges();
    expect(changes).toContain("active-change");
    expect(changes).not.toContain("old-change");
    expect(changes).not.toContain("archive");
  });

  test("listChanges returns only non-archive top-level change directories", async () => {
    mkdirSync(join(tempDir, "openspec", "changes", "change-a"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "change-b"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "archive"), { recursive: true });
    mkdirSync(join(tempDir, "openspec", "changes", "archive", "old"), { recursive: true });

    const store = new OpenSpecChangeStore();
    const changes = (await store.listChanges()).sort();
    expect(changes).toEqual(["change-a", "change-b"]);
  });
});
