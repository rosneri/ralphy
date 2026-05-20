import { homedir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import type { Bus } from "../bus";
import type { RalphEvent } from "../types";

export interface FileLoggerOptions {
  /** Root directory containing the `logs/` subdir. Defaults to
   *  `Bun.env.RALPH_HOME ?? ~/.ralph/ralphy`. */
  rootDir?: string;
  /** Maximum age (days) before a JSONL file gets gzip-archived on startup. */
  maxAgeDays?: number;
}

function defaultRootDir(): string {
  const envHome = (Bun.env as Record<string, string | undefined>)["RALPH_HOME"];
  if (envHome && envHome.length > 0) return envHome;
  return join(homedir(), ".ralph", "ralphy");
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface CachedWriter {
  path: string;
  writer: ReturnType<ReturnType<typeof Bun.file>["writer"]>;
}

/**
 * Subscribes a JSONL file writer to the bus. Rotates per local date
 * derived from `event.ts`; on startup gzips files older than maxAgeDays.
 * All failures become `__bus_error__` events on the same bus instead of
 * throwing.
 */
export function subscribeFileLogger(bus: Bus, options: FileLoggerOptions = {}): () => void {
  const root = options.rootDir ?? defaultRootDir();
  const logsDir = join(root, "logs");
  const maxAgeDays = options.maxAgeDays ?? 14;
  let cached: CachedWriter | null = null;
  let reentering = false;

  void (async () => {
    try {
      await mkdir(logsDir, { recursive: true });
      await runHousekeeping(logsDir, maxAgeDays);
    } catch (err) {
      reportBusError(bus, "file-logger", err);
    }
  })();

  function writerFor(path: string): CachedWriter {
    if (cached && cached.path === path) return cached;
    if (cached) {
      try {
        cached.writer.end();
      } catch {
        // ignore — the next emit will rotate again if needed
      }
    }
    const next: CachedWriter = {
      path,
      writer: Bun.file(path).writer(),
    };
    cached = next;
    return next;
  }

  const unsub = bus.on("*", (event: RalphEvent) => {
    if (event.type === "__bus_error__" && reentering) return;
    const date = localDateKey(event.ts);
    const path = join(logsDir, `${date}.jsonl`);
    try {
      const cw = writerFor(path);
      cw.writer.write(JSON.stringify(event) + "\n");
      cw.writer.flush();
    } catch (err) {
      reentering = true;
      try {
        reportBusError(bus, "file-logger", err);
      } finally {
        reentering = false;
      }
    }
  });

  return () => {
    unsub();
    if (cached) {
      try {
        cached.writer.end();
      } catch {
        // ignore
      }
      cached = null;
    }
  };
}

function reportBusError(bus: Bus, consumer: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  bus.emit({
    type: "__bus_error__",
    consumer,
    error_message: e.message,
    ...(e.stack ? { error_stack: e.stack } : {}),
  });
}

async function runHousekeeping(logsDir: string, maxAgeDays: number): Promise<void> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const glob = new Bun.Glob("*.jsonl");
  for await (const rel of glob.scan({ cwd: logsDir, absolute: false })) {
    const date = rel.replace(/\.jsonl$/, "");
    const parsed = parseDateKey(date);
    if (parsed === null) continue;
    if (parsed > cutoff) continue;
    const full = join(logsDir, rel);
    const file = Bun.file(full);
    const size = file.size;
    if (size <= 0) {
      await rm(full).catch(() => undefined);
      continue;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const gz = Bun.gzipSync(buf);
    await Bun.write(`${full}.gz`, gz);
    await rm(full);
  }
}

function parseDateKey(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(y, mo - 1, d).getTime();
  return Number.isFinite(t) ? t : null;
}
