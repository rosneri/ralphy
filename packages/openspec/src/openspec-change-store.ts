import { dirname, join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import type { ChangeStore, ValidationResult } from "@ralphy/change-store";
import { resolveOpenspecBin } from "./openspec-bin";

type RunResult = { status: number | null; stdout: string; stderr: string };

function runOpenspec(args: string[], options: { inherit?: boolean } = {}): RunResult {
  const stdio = options.inherit
    ? (["inherit", "inherit", "inherit"] as const)
    : (["ignore", "pipe", "pipe"] as const);
  const proc = Bun.spawnSync({
    cmd: [process.execPath, resolveOpenspecBin(import.meta.dir), ...args],
    stdio: stdio as ["inherit", "inherit", "inherit"] | ["ignore", "pipe", "pipe"],
  });
  const decoder = new TextDecoder();
  return {
    status: proc.exitCode,
    stdout: proc.stdout ? decoder.decode(proc.stdout) : "",
    stderr: proc.stderr ? decoder.decode(proc.stderr) : "",
  };
}

/**
 * OpenSpec-backed implementation of ChangeStore.
 * Invokes the bundled `@fission-ai/openspec` bin with Bun — no PATH dependency.
 */
export class OpenSpecChangeStore implements ChangeStore {
  async createChange(name: string, description: string): Promise<void> {
    const result = runOpenspec(["new", "change", name, "--description", description], {
      inherit: true,
    });
    if (result.status !== 0) {
      throw new Error("openspec new change failed");
    }
  }

  getChangeDirectory(name: string): string {
    return join("openspec", "changes", name);
  }

  async listChanges(): Promise<string[]> {
    const result = runOpenspec(["list", "--json"]);

    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as { changes?: { name: string }[] } | string[];
        if (Array.isArray(parsed)) return parsed.map((item) => String(item));
        if (parsed && typeof parsed === "object" && "changes" in parsed && parsed.changes) {
          return parsed.changes.map((change) => change.name);
        }
      } catch {
        // Fall through to directory scan
      }
    }

    const changesDir = join("openspec", "changes");
    if (!(await Bun.file(changesDir).exists())) return [];
    try {
      const entries = await readdir(changesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name !== "archive")
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  async readTaskList(name: string): Promise<string> {
    const file = Bun.file(join("openspec", "changes", name, "tasks.md"));
    if (!(await file.exists())) return "";
    return await file.text();
  }

  async writeTaskList(name: string, content: string): Promise<void> {
    const path = join("openspec", "changes", name, "tasks.md");
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
  }

  async appendSteering(name: string, message: string): Promise<void> {
    const path = join("openspec", "changes", name, "steering.md");
    const file = Bun.file(path);
    const existing = (await file.exists()) ? await file.text() : null;
    const updated = existing ? `${message}\n\n${existing.trimStart()}` : `${message}\n`;
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, updated);
  }

  async readSection(name: string, artifact: string, heading: string): Promise<string> {
    const file = Bun.file(join("openspec", "changes", name, artifact));
    if (!(await file.exists())) return "";

    const content = await file.text();
    const headingIndex = content.indexOf(heading);
    if (headingIndex === -1) return "";

    const afterHeading = content.slice(headingIndex + heading.length);
    const levelMatch = heading.match(/^(#+)/);
    const level = levelMatch ? levelMatch[1]!.length : 2;
    const nextHeadingPattern = new RegExp(`\\n#{1,${level}} `);
    const nextMatch = afterHeading.match(nextHeadingPattern);

    const sectionContent = nextMatch ? afterHeading.slice(0, nextMatch.index) : afterHeading;
    return sectionContent.trim();
  }

  async validateChange(name: string): Promise<ValidationResult> {
    const result = runOpenspec(["validate", name, "--json", "--no-interactive"]);

    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as {
          valid?: boolean;
          warnings?: string[];
          errors?: string[];
        };
        return {
          valid: parsed.valid ?? result.status === 0,
          warnings: parsed.warnings ?? [],
          errors: parsed.errors ?? [],
        };
      } catch {
        // Fall through to status-based result
      }
    }

    return {
      valid: result.status === 0,
      warnings: [],
      errors: result.stderr ? [result.stderr] : [],
    };
  }

  async archiveChange(name: string): Promise<void> {
    const result = runOpenspec(["archive", name, "-y", "--skip-specs"], { inherit: true });
    if (result.status !== 0) {
      throw new Error("openspec archive failed");
    }
  }
}
