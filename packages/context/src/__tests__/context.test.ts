import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import {
  createFileSystemProvider,
  getContext,
  getStorage,
  runWithContext,
  createDefaultContext,
} from "../context";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "context-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileSystemProvider", () => {
  test("read returns null for non-existent file", () => {
    const provider = createFileSystemProvider();
    expect(provider.read(join(tempDir, "missing.txt"))).toBeNull();
  });

  test("read returns file contents for existing file", () => {
    const provider = createFileSystemProvider();
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "hello world", "utf-8");
    expect(provider.read(filePath)).toBe("hello world");
  });

  test("write creates file and parent dirs", () => {
    const provider = createFileSystemProvider();
    const filePath = join(tempDir, "sub", "dir", "test.txt");
    provider.write(filePath, "content");
    expect(existsSync(filePath)).toBe(true);
    expect(provider.read(filePath)).toBe("content");
  });

  test("remove deletes an existing file", () => {
    const provider = createFileSystemProvider();
    const filePath = join(tempDir, "remove-me.txt");
    writeFileSync(filePath, "data", "utf-8");
    expect(existsSync(filePath)).toBe(true);

    provider.remove(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  test("remove is a no-op for non-existent file", () => {
    const provider = createFileSystemProvider();
    // should not throw
    provider.remove(join(tempDir, "does-not-exist.txt"));
  });

  test("list returns filenames in directory", () => {
    const provider = createFileSystemProvider();
    writeFileSync(join(tempDir, "a.txt"), "a");
    writeFileSync(join(tempDir, "b.txt"), "b");
    const files = provider.list(tempDir);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });

  test("list returns empty array for non-existent directory", () => {
    const provider = createFileSystemProvider();
    expect(provider.list(join(tempDir, "nope"))).toEqual([]);
  });
});

describe("getContext", () => {
  test("throws when no context is set", () => {
    expect(() => getContext()).toThrow("No AppContext set");
  });

  test("returns the context inside runWithContext", () => {
    const ctx = createDefaultContext();
    runWithContext(ctx, () => {
      expect(getContext()).toBe(ctx);
    });
  });
});

describe("getStorage", () => {
  test("returns the storage provider from the current context", () => {
    const ctx = createDefaultContext();
    runWithContext(ctx, () => {
      expect(getStorage()).toBe(ctx.storage);
    });
  });
});

describe("runWithContext", () => {
  test("provides the context to the callback", () => {
    const storage = createFileSystemProvider();
    const ctx = { storage };
    const result = runWithContext(ctx, () => {
      return getContext().storage === storage;
    });
    expect(result).toBe(true);
  });

  test("returns the callback return value", () => {
    const ctx = createDefaultContext();
    const result = runWithContext(ctx, () => 42);
    expect(result).toBe(42);
  });
});

describe("createDefaultContext", () => {
  test("creates a context with a storage provider", () => {
    const ctx = createDefaultContext();
    expect(ctx.storage).toBeDefined();
    expect(typeof ctx.storage.read).toBe("function");
    expect(typeof ctx.storage.write).toBe("function");
    expect(typeof ctx.storage.remove).toBe("function");
    expect(typeof ctx.storage.list).toBe("function");
  });
});

describe("createFileSystemProvider", () => {
  test("returns a fresh provider each time", () => {
    const a = createFileSystemProvider();
    const b = createFileSystemProvider();
    expect(a).not.toBe(b);
  });

  test("provider methods are callable", () => {
    const provider = createFileSystemProvider();
    // exercise all four methods to ensure full coverage
    const result = provider.read(join(tempDir, "nonexistent"));
    expect(result).toBeNull();

    provider.write(join(tempDir, "fsp-test.txt"), "data");
    expect(provider.read(join(tempDir, "fsp-test.txt"))).toBe("data");

    provider.remove(join(tempDir, "fsp-test.txt"));
    expect(provider.read(join(tempDir, "fsp-test.txt"))).toBeNull();

    expect(provider.list(join(tempDir, "nonexistent-dir"))).toEqual([]);
  });
});
