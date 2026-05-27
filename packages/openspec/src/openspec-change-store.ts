import { dirname, join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import type {
  ChangeStore,
  ValidationResult,
  ChangeStatus,
  ArtifactInstructions,
  ChangeDeltas,
} from "@ralphy/change-store";
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

/** Append a `- [ ]` line to the `## Steering` section of a tasks.md
 *  document. When the section is missing it is appended to the end of
 *  the file (with a blank-line separator). Exported for unit tests. */
export function appendSteeringTaskToTasksMd(existing: string, taskLine: string): string {
  const SECTION = "## Steering";
  const trimmed = existing.replace(/\s+$/, "");
  if (trimmed.length === 0) {
    return `${SECTION}\n\n${taskLine}\n`;
  }
  const lines = trimmed.split(/\r?\n/);
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+Steering\s*$/i.test(lines[i]!)) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) {
    return `${trimmed}\n\n${SECTION}\n\n${taskLine}\n`;
  }
  // Find the next H2 (end of the section); insert before it.
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  // Strip trailing blank lines inside the section so the new bullet
  // sits flush against the existing ones.
  let insertAt = sectionEnd;
  while (insertAt - 1 > sectionStart && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  const out = [...before, taskLine, ...(after.length ? [""] : []), ...after].join("\n");
  return out.endsWith("\n") ? out : `${out}\n`;
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

    // Mirror the steering note as a concrete `- [ ] Address steering: …`
    // task so the next loop iteration picks it up. The full message stays
    // in steering.md; tasks.md only carries the headline (first non-blank
    // line, trimmed) so the checklist stays readable.
    const firstLine =
      message
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? message.trim();
    if (firstLine.length === 0) return;
    const tasksPath = join("openspec", "changes", name, "tasks.md");
    const tasksFile = Bun.file(tasksPath);
    const existingTasks = (await tasksFile.exists()) ? await tasksFile.text() : "";
    const taskLine = `- [ ] Address steering: ${firstLine}`;
    const next = appendSteeringTaskToTasksMd(existingTasks, taskLine);
    await mkdir(dirname(tasksPath), { recursive: true });
    await Bun.write(tasksPath, next);
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

  async getStatus(name: string): Promise<ChangeStatus> {
    const result = runOpenspec(["status", "--change", name, "--json"]);
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as Partial<ChangeStatus>;
        const status: ChangeStatus = {
          changeName: parsed.changeName ?? name,
          isComplete: parsed.isComplete ?? false,
          applyRequires: parsed.applyRequires ?? [],
          artifacts: parsed.artifacts ?? [],
        };
        if (parsed.schemaName !== undefined) status.schemaName = parsed.schemaName;
        return status;
      } catch {
        // Fall through.
      }
    }
    return {
      changeName: name,
      isComplete: false,
      applyRequires: [],
      artifacts: [],
    };
  }

  async getInstructions(name: string, artifact: string): Promise<ArtifactInstructions> {
    const result = runOpenspec(["instructions", artifact, "--change", name, "--json"]);
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as Partial<ArtifactInstructions>;
        const out: ArtifactInstructions = {
          changeName: parsed.changeName ?? name,
          artifactId: parsed.artifactId ?? artifact,
          instruction: parsed.instruction ?? "",
        };
        if (parsed.outputPath !== undefined) out.outputPath = parsed.outputPath;
        if (parsed.description !== undefined) out.description = parsed.description;
        if (parsed.template !== undefined) out.template = parsed.template;
        if (parsed.dependencies !== undefined) out.dependencies = parsed.dependencies;
        return out;
      } catch {
        // Fall through.
      }
    }
    return { changeName: name, artifactId: artifact, instruction: "" };
  }

  async showChange(name: string): Promise<ChangeDeltas> {
    const result = runOpenspec(["show", name, "--json", "--type", "change"]);
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as Partial<ChangeDeltas>;
        const out: ChangeDeltas = {
          id: parsed.id ?? name,
          deltaCount: parsed.deltaCount ?? 0,
          deltas: parsed.deltas ?? [],
        };
        if (parsed.title !== undefined) out.title = parsed.title;
        return out;
      } catch {
        // Fall through.
      }
    }
    return { id: name, deltaCount: 0, deltas: [] };
  }

  async archiveChange(name: string): Promise<void> {
    const result = runOpenspec(["archive", name, "-y"], { inherit: true });
    if (result.status !== 0) {
      throw new Error("openspec archive failed");
    }
  }
}
