import { AsyncLocalStorage } from "node:async_hooks";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname } from "node:path";
import type { StorageProvider, ProjectLayout } from "@ralphy/types";
import type { CommonArgs } from "@ralphy/cli-args";

export type { StorageProvider } from "@ralphy/types";
export type { ProjectLayout } from "@ralphy/types";
export type { CommonArgs } from "@ralphy/cli-args";

class FileSystemProvider implements StorageProvider {
  read(path: string): string | null {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }
  write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }
  remove(path: string): void {
    if (!existsSync(path)) return;
    unlinkSync(path);
  }
  list(prefix: string): string[] {
    if (!existsSync(prefix)) return [];
    return readdirSync(prefix) as string[];
  }
}

export function createFileSystemProvider(): StorageProvider {
  return new FileSystemProvider();
}

export interface AppContext {
  storage: StorageProvider;
  layout?: ProjectLayout;
  args?: CommonArgs;
}

const contextStore = new AsyncLocalStorage<AppContext>();

/** Get the current AppContext from AsyncLocalStorage. Throws if not set. */
export function getContext(): AppContext {
  const ctx = contextStore.getStore();
  if (!ctx) throw new Error("No AppContext set. Call runWithContext() first.");
  return ctx;
}

/** Shorthand: get the storage provider from the current context. */
export function getStorage(): StorageProvider {
  return getContext().storage;
}

/** Get the current ProjectLayout from context. Throws if not set. */
export function getLayout(): ProjectLayout {
  const ctx = getContext();
  if (!ctx.layout)
    throw new Error("No layout in context. Set layout when calling runWithContext().");
  return ctx.layout;
}

/** Get the current CommonArgs from context. Throws if not set. */
export function getArgs(): CommonArgs {
  const ctx = getContext();
  if (!ctx.args) throw new Error("No args in context. Set args when calling runWithContext().");
  return ctx.args;
}

/** Run a function with the given AppContext in scope. */
export function runWithContext<T>(ctx: AppContext, fn: () => T): T {
  return contextStore.run(ctx, fn);
}

/** Create a default AppContext with FileSystemProvider and optional overrides. */
export function createDefaultContext(
  overrides: Partial<Pick<AppContext, "layout" | "args">> = {},
): AppContext {
  return { storage: createFileSystemProvider(), ...overrides };
}
