import { createActor, type Actor, type SnapshotFrom, type InspectionEvent } from "xstate";
import { flowMachine, type FlowAssignment, type FlowInput, type FlowRuntime } from "./flow.machine";
import { writeField, readSlotSidecar } from "../state/store";
import { createNoopBus, type Bus } from "@ralphy/events";

const STATE_FILE = ".ralph-state.json";

export interface FlowActorDeps {
  bus: Bus;
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  graceMs?: number;
  /** Quarantine threshold seeded into every actor's context
   *  (`prRecovery.maxRecoverySessions`). `0` / absent disables quarantine. */
  maxRecoveryAttempts?: number;
  /**
   * Observational hook fired on every *value* transition of a flow actor.
   * Read-only — XState `inspect` cannot alter the machine, so this can never
   * change stop/flow behavior. Used to append a debuggable per-change
   * transition timeline. `changeDir` is whatever {@link FlowActorStore.getActor}
   * was called with (`undefined` for in-memory-only actors). No-op events
   * (same value in, same value out) are not reported.
   */
  onTransition?: (
    issueId: string,
    changeDir: string | undefined,
    transition: { from: string; event: string; to: string },
  ) => void;
}

export class FlowActorStore {
  private actors = new Map<string, Actor<typeof flowMachine>>();
  private readonly machine: typeof flowMachine;

  constructor(
    private readonly deps?: FlowActorDeps,
    machine?: typeof flowMachine,
  ) {
    this.machine = machine ?? flowMachine;
  }

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

    const input: FlowInput = {
      issueId: key,
      ...(this.deps
        ? {
            bus: this.deps.bus,
            persist: this.deps.persist,
            ...(this.deps.graceMs !== undefined ? { graceMs: this.deps.graceMs } : {}),
            ...(this.deps.maxRecoveryAttempts !== undefined
              ? { maxRecoveryAttempts: this.deps.maxRecoveryAttempts }
              : {}),
          }
        : {}),
    };

    const inspector = this.deps?.onTransition ? this.makeInspect(key, changeDir) : null;

    if (changeDir) {
      const snapshot = await this.loadSnapshot(changeDir);
      if (snapshot !== null && this.isValidSnapshot(snapshot)) {
        try {
          // XState v5 restores context verbatim from the snapshot and does not
          // re-run the context factory, so the non-serializable `runtime`
          // handles (lost to JSON) must be spliced back in here — re-passing
          // `input` does not repopulate them.
          const restored = this.withRestoredRuntime(snapshot);
          const a = createActor(this.machine, {
            snapshot: restored as SnapshotFrom<typeof flowMachine>,
            input,
            ...(inspector ? { inspect: inspector.inspect } : {}),
          });
          inspector?.setRoot(a);
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

    const a = createActor(this.machine, {
      input,
      ...(inspector ? { inspect: inspector.inspect } : {}),
    });
    inspector?.setRoot(a);
    a.start();
    this.actors.set(key, a);
    return a;
  }

  /**
   * A fresh, process-bound {@link FlowRuntime} sourced from the store's deps.
   * `worker` / `teardown` are always `undefined` on rehydrate — a live worker
   * cannot outlive the process that spawned it.
   */
  private buildRuntime(): FlowRuntime {
    return {
      bus: this.deps?.bus ?? createNoopBus(),
      persist: this.deps?.persist ?? (() => {}),
      worker: undefined,
      teardown: undefined,
    };
  }

  /**
   * Rebuild a persisted snapshot's `context` for restore: keep the serializable
   * `context.data`, replace `context.runtime` with a freshly-injected one (the
   * serialized handles are dead). Also migrates pre-split snapshots, whose
   * serializable fields lived at the top level of `context`
   * (`issueId` / `graceMs` / `currentAssignment` / `pendingAssignment`), into
   * `context.data` so in-flight runs survive the upgrade rather than resetting
   * to `idle`.
   */
  private withRestoredRuntime(snapshot: unknown): unknown {
    if (!snapshot || typeof snapshot !== "object") return snapshot;
    const snap = snapshot as { context?: Record<string, unknown> };
    const context = snap.context ?? {};
    const data =
      context.data && typeof context.data === "object"
        ? (context.data as Record<string, unknown>)
        : {
            issueId: context.issueId,
            graceMs: context.graceMs ?? 5000,
            maxRecoveryAttempts: this.deps?.maxRecoveryAttempts ?? 0,
            currentAssignment: context.currentAssignment,
            pendingAssignment: context.pendingAssignment,
            recovery: undefined,
          };
    return { ...snap, context: { data, runtime: this.buildRuntime() } };
  }

  /**
   * Build the per-actor `inspect` closure for the transition timeline. Only the
   * root flow actor's value changes are reported — the spawned `preemption`
   * child's inspection events also arrive here and are filtered out by the
   * `actorRef === root` check. Errors in the callback are swallowed so logging
   * can never break the actor.
   */
  private makeInspect(
    issueId: string,
    changeDir: string | undefined,
  ): {
    inspect: (event: InspectionEvent) => void;
    setRoot: (actor: Actor<typeof flowMachine>) => void;
  } {
    let root: Actor<typeof flowMachine> | undefined;
    let previous: string | undefined;
    const inspect = (event: InspectionEvent): void => {
      if (event.type !== "@xstate.snapshot" || event.actorRef !== root) return;
      const value = (event.snapshot as { value?: unknown }).value;
      const to = typeof value === "string" ? value : JSON.stringify(value);
      const eventType = (event.event as { type?: string }).type ?? "?";
      if (previous !== undefined && previous !== to) {
        try {
          this.deps?.onTransition?.(issueId, changeDir, { from: previous, event: eventType, to });
        } catch {
          /* observational — never let logging break the actor */
        }
      }
      previous = to;
    };
    return {
      inspect,
      setRoot: (actor) => {
        root = actor;
      },
    };
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
    // Authoritative copy lives in the `.ralph-state.flow.json` sidecar
    // (written via `writeField` → single-writer, clobber-free).
    const sidecar = await readSlotSidecar(changeDir, "flow");
    if (sidecar && typeof sidecar === "object") {
      const snap = (sidecar as Record<string, unknown>).actorSnapshot;
      if (snap !== undefined && snap !== null) return snap;
    }
    // Migration: fall back to the legacy inline `flow.actorSnapshot`.
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
