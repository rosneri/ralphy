/**
 * Domain interface for managing Ralphy changes.
 *
 * All code in apps/ and other packages/ should depend on this interface.
 * OpenSpec is the current implementation behind this abstraction —
 * swapping it out only requires a new implementation of ChangeStore.
 */

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ArtifactStatus {
  id: string;
  outputPath?: string;
  status: "ready" | "done" | "blocked" | string;
  missingDeps?: string[];
}

export interface ChangeStatus {
  changeName: string;
  schemaName?: string;
  isComplete: boolean;
  applyRequires: string[];
  artifacts: ArtifactStatus[];
}

export interface ArtifactInstructions {
  changeName: string;
  artifactId: string;
  outputPath?: string;
  description?: string;
  instruction: string;
  template?: string;
  dependencies?: { id: string; done: boolean; path?: string; description?: string }[];
}

export interface ChangeDeltas {
  id: string;
  title?: string;
  deltaCount: number;
  deltas: unknown[];
}

export interface ChangeStore {
  /**
   * Create a new change with the given name and description.
   */
  createChange(name: string, description: string): Promise<void>;

  /**
   * Return the filesystem path to the change directory for the given name.
   */
  getChangeDirectory(name: string): string;

  /**
   * List the names of all active changes.
   */
  listChanges(): Promise<string[]>;

  /**
   * Read the task list document for the given change.
   */
  readTaskList(name: string): Promise<string>;

  /**
   * Write the task list document for the given change.
   */
  writeTaskList(name: string, content: string): Promise<void>;

  /**
   * Append a steering message to the proposal document for the given change.
   */
  appendSteering(name: string, message: string): Promise<void>;

  /**
   * Validate the given change and return structured results.
   */
  validateChange(name: string): Promise<ValidationResult>;

  /**
   * Return artifact completion status for the change (canonical OpenSpec view).
   */
  getStatus(name: string): Promise<ChangeStatus>;

  /**
   * Return enriched instructions/template for creating a specific artifact
   * (proposal | specs | design | tasks) within the change.
   */
  getInstructions(name: string, artifact: string): Promise<ArtifactInstructions>;

  /**
   * Return structured spec-delta info for the change.
   */
  showChange(name: string): Promise<ChangeDeltas>;

  /**
   * Archive the given change once it is complete.
   */
  archiveChange(name: string): Promise<void>;
}
