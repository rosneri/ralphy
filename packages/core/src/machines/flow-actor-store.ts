import { createActor, type Actor, type SnapshotFrom } from "xstate";
import { flowMachine } from "./flow.machine";
import { writeField } from "../state/store";

const STATE_FILE = ".ralph-state.json";

export class FlowActorStore {
  private actors = new Map<string, Actor<typeof flowMachine>>();

  /**
   * Get the actor for `key` (typically issue.id or changeName). If the actor
   * is already in memory it is returned directly. Otherwise, if `changeDir` is
   * provided, the persisted snapshot is loaded from
   * `<changeDir>/.ralph-state.json` and the actor is rehydrated. Falls back
   * to a fresh actor in `idle` when no snapshot is found or on parse error.
   */
  async getActor(key: string, changeDir?: string): Promise<Actor<typeof flowMachine>> {
    const existing = this.actors.get(key);
    if (existing) return existing;

    if (changeDir) {
      const snapshot = await this.loadSnapshot(changeDir);
      if (snapshot !== null && this.isValidSnapshot(snapshot)) {
        try {
          const a = createActor(flowMachine, {
            snapshot: snapshot as SnapshotFrom<typeof flowMachine>,
          });
          a.start();
          if (a.getSnapshot().value !== undefined) {
            this.actors.set(key, a);
            return a;
          }
          // Actor created but has no state — snapshot was structurally invalid
          try {
            a.stop();
          } catch {
            /* ignore */
          }
        } catch {
          // Snapshot incompatible (machine definition drift) — fall through to fresh
        }
      }
    }

    const a = createActor(flowMachine);
    a.start();
    this.actors.set(key, a);
    return a;
  }

  /**
   * Return the actor if it is already in memory, without touching disk.
   * Returns null when no in-memory actor exists for `key`.
   */
  peekActor(key: string): Actor<typeof flowMachine> | null {
    return this.actors.get(key) ?? null;
  }

  /**
   * Persist the current actor snapshot for `key` to
   * `<changeDir>/.ralph-state.json` under `flow.actorSnapshot`. No-op when
   * no actor is registered for `key`.
   */
  async persistActor(key: string, changeDir: string): Promise<void> {
    const actor = this.actors.get(key);
    if (!actor) return;
    const snapshot = actor.getPersistedSnapshot();
    await writeField(changeDir, "coordinator", "flow.actorSnapshot", snapshot);
  }

  /**
   * Stop the actor for `key` and remove it from the in-memory map. No-op
   * when no actor is registered.
   */
  disposeActor(key: string): void {
    const actor = this.actors.get(key);
    if (!actor) return;
    try {
      actor.stop();
    } catch {
      /* ignore */
    }
    this.actors.delete(key);
  }

  private isValidSnapshot(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
    const s = snapshot as Record<string, unknown>;
    return typeof s.value === "string" || typeof s.status === "string";
  }

  private async loadSnapshot(changeDir: string): Promise<unknown> {
    const filePath = `${changeDir}/${STATE_FILE}`;
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    try {
      const data: unknown = await file.json();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const flow = (data as Record<string, unknown>).flow;
        if (flow && typeof flow === "object" && !Array.isArray(flow)) {
          return (flow as Record<string, unknown>).actorSnapshot ?? null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
