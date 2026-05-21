import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TmpFs {
  root: string;
  ralphRoot: string;
  openspecRoot: string;
  seedTasks: (changeName: string, lines: string[]) => Promise<string>;
  seedProposal: (changeName: string, body: string) => Promise<string>;
  seedDesign: (changeName: string, body: string) => Promise<string>;
  mutateState: (
    changeName: string,
    fn: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => Promise<void>;
  cleanup: () => Promise<void>;
}

export async function createTmpFs(): Promise<TmpFs> {
  const root = await mkdtemp(join(tmpdir(), "ralphy-harness-fs-"));
  const ralphRoot = join(root, ".ralph");
  const openspecRoot = join(root, "openspec");
  await mkdir(ralphRoot, { recursive: true });
  await mkdir(openspecRoot, { recursive: true });

  const changeDir = (changeName: string): string => join(openspecRoot, "changes", changeName);

  async function seedTasks(changeName: string, lines: string[]): Promise<string> {
    const dir = changeDir(changeName);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "tasks.md");
    await Bun.write(file, lines.join("\n") + "\n");
    return file;
  }

  async function seedProposal(changeName: string, body: string): Promise<string> {
    const dir = changeDir(changeName);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "proposal.md");
    await Bun.write(file, body);
    return file;
  }

  async function seedDesign(changeName: string, body: string): Promise<string> {
    const dir = changeDir(changeName);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "design.md");
    await Bun.write(file, body);
    return file;
  }

  async function mutateState(
    changeName: string,
    fn: (prev: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const dir = join(ralphRoot, "tasks", changeName);
    await mkdir(dir, { recursive: true });
    const file = join(dir, ".ralph-state.json");
    let prev: Record<string, unknown> = {};
    try {
      const txt = await readFile(file, "utf8");
      prev = JSON.parse(txt) as Record<string, unknown>;
    } catch {
      prev = {};
    }
    const next = fn(prev);
    await writeFile(file, JSON.stringify(next, null, 2));
  }

  async function cleanup(): Promise<void> {
    await rm(root, { recursive: true, force: true });
  }

  return {
    root,
    ralphRoot,
    openspecRoot,
    seedTasks,
    seedProposal,
    seedDesign,
    mutateState,
    cleanup,
  };
}
