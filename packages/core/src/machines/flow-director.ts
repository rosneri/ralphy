import type { EventFrom } from "xstate";
import { flowMachine } from "./flow.machine";
import type { FlowRecovery } from "./flow-machine-types";
import type { FlowActorStore } from "./flow-actor-store";

/** Locator for one issue's flow actor: the registry key (issue id) plus the
 *  change directory its snapshot persists to (absent → in-memory only). */
export interface FlowRef {
  key: string;
  changeDir?: string | undefined;
}

export type FlowDispatchEvent = EventFrom<typeof flowMachine>;

/**
 * The data consumers may see of a flow actor. Nothing outside the director
 * holds an XState `Actor` — callers read this plain view instead, so actor
 * lifetime (rehydrate / persist / dispose) stays in exactly one place.
 */
export interface FlowSnapshotView {
  issueId: string;
  /** Machine state value, e.g. "working" / "awaiting-ci" / "quarantined". */
  value: string;
  recovery: FlowRecovery | undefined;
}

/**
 * The ONE gateway to flow actors. Replaces the hand-rolled
 * `getActor → send → persistActor` triplet that was repeated across the
 * coordinator: `dispatch` performs the rehydrate → send → persist sequence
 * atomically, serialized per key, and returns the resulting snapshot view.
 *
 * Persist failures are deliberately swallowed (matching the historical
 * `.catch(() => {})` at every call site): a missed snapshot write degrades to
 * an in-memory-only actor, never to a broken poll.
 */
export class FlowDirector {
  /** Per-key dispatch chains — concurrent dispatches on the same key run in
   *  arrival order; different keys run independently. */
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly store: FlowActorStore) {}

  /** Rehydrate (if needed), send `events` in order, persist, return the view. */
  async dispatch(ref: FlowRef, ...events: FlowDispatchEvent[]): Promise<FlowSnapshotView> {
    return this.withKeyLock(ref.key, async () => {
      const actor = await this.store.getActor(ref.key, ref.changeDir);
      for (const event of events) actor.send(event);
      if (ref.changeDir) {
        await this.store.persistActor(ref.key, ref.changeDir).catch(() => {});
      }
      return toView(ref.key, actor.getSnapshot());
    });
  }

  /** Rehydrating read — no events, no persist. */
  async view(ref: FlowRef): Promise<FlowSnapshotView> {
    return this.withKeyLock(ref.key, async () => {
      const actor = await this.store.getActor(ref.key, ref.changeDir);
      return toView(ref.key, actor.getSnapshot());
    });
  }

  /** In-memory, synchronous read. Null when no actor is loaded for `key`. */
  peek(key: string): FlowSnapshotView | null {
    const actor = this.store.peekActor(key);
    return actor ? toView(key, actor.getSnapshot()) : null;
  }

  /**
   * Send `events` to an already-loaded actor without touching disk. Used for
   * process-bound events whose payload cannot survive a persist anyway
   * (`WORKER_SPAWNED` carries live handles, `PREEMPT` races a kill). Returns
   * null (and sends nothing) when no actor is in memory for `key`.
   */
  dispatchLoaded(key: string, ...events: FlowDispatchEvent[]): FlowSnapshotView | null {
    const actor = this.store.peekActor(key);
    if (!actor) return null;
    for (const event of events) actor.send(event);
    return toView(key, actor.getSnapshot());
  }

  /** Dispose the actor when it has reached a terminal value (`done`/`error`). */
  disposeIfDone(key: string): void {
    const view = this.peek(key);
    if (view && (view.value === "done" || view.value === "error")) {
      this.store.disposeActor(key);
    }
  }

  private withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(
      () => {},
      () => {},
    );
    this.chains.set(key, tail);
    void tail.finally(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return next;
  }
}

function toView(
  key: string,
  snapshot: {
    value: unknown;
    context: { data: { issueId: string; recovery: FlowRecovery | undefined } };
  },
): FlowSnapshotView {
  return {
    issueId: snapshot.context.data.issueId || key,
    value: String(snapshot.value),
    recovery: snapshot.context.data.recovery,
  };
}
