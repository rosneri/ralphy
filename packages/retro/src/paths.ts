import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Directory retrospective reports are written to: `~/.ralph/retro`. */
export function retroDir(): string {
  return join(homedir(), ".ralph", "retro");
}

/**
 * Resolve the absolute path for a retrospective report and ensure its parent
 * directory exists. The base name is `<identifier>-<date>.md`; if that already
 * exists (a different disposition earlier the same day, or a prior session) we
 * append `-2`, `-3`, … so an earlier report is never overwritten.
 *
 * `dir` defaults to `retroDir()`; tests pass a tmp dir. Uses Bun-native
 * existence checks (no `node:fs` sync APIs).
 */
export async function resolveRetroOutputPath(
  identifier: string,
  date: string,
  dir: string = retroDir(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${identifier}-${date}.md`);
  if (!(await Bun.file(base).exists())) return base;
  for (let n = 2; ; n++) {
    const candidate = join(dir, `${identifier}-${date}-${n}.md`);
    if (!(await Bun.file(candidate).exists())) return candidate;
  }
}
