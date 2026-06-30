import { setupBackupPath } from "@ralphy/paths";
import type { SetupMode, WizardValue } from "@ralphy/workflow/wizard-types";

/** The shape persisted to `~/.ralph/setup.tmp` for resuming an interrupted run. */
interface SetupBackup {
  projectRoot: string;
  mode: SetupMode;
  values: Record<string, WizardValue>;
}

/**
 * Read a backed-up setup session for `projectRoot`. Returns null when none is
 * saved, it belongs to a different project, or it cannot be parsed — so a stale
 * or foreign backup never restores the wrong answers.
 */
export async function readSetupBackup(
  projectRoot: string,
): Promise<{ mode: SetupMode; values: Record<string, WizardValue> } | null> {
  const file = Bun.file(setupBackupPath());
  if (!(await file.exists())) return null;
  try {
    const data = JSON.parse(await file.text()) as Partial<SetupBackup>;
    if (data.projectRoot !== projectRoot) return null;
    if (data.mode !== "quick" && data.mode !== "permissive" && data.mode !== "customized") {
      return null;
    }
    if (!data.values || typeof data.values !== "object") return null;
    return { mode: data.mode, values: data.values };
  } catch {
    return null;
  }
}

/** Persist the in-progress setup session (creating `~/.ralph` as needed). */
export async function writeSetupBackup(
  projectRoot: string,
  mode: SetupMode,
  values: Record<string, WizardValue>,
): Promise<void> {
  const backup: SetupBackup = { projectRoot, mode, values };
  await Bun.write(setupBackupPath(), JSON.stringify(backup, null, 2));
}

/** Remove the setup backup, if present. */
export async function clearSetupBackup(): Promise<void> {
  const file = Bun.file(setupBackupPath());
  if (await file.exists()) await file.delete();
}
