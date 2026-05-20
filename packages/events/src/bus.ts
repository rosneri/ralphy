import type { EmitInput, RalphEvent, RalphEventType } from "./types";
import { createRing, type Ring } from "./ring";

export type Listener<E extends RalphEvent = RalphEvent> = (event: E) => void;

export interface Bus {
  emit(event: EmitInput): void;
  on<T extends RalphEventType>(
    type: T | "*",
    listener: Listener<Extract<RalphEvent, { type: T }>>,
  ): () => void;
  snapshot(): RalphEvent[];
}

interface NamedListener {
  name: string;
  fn: Listener;
}

const DEFAULT_CAPACITY = 2000;
const MAX_ERROR_DEPTH = 4;

export function createBus(capacity: number = DEFAULT_CAPACITY): Bus {
  const ring: Ring<RalphEvent> = createRing<RalphEvent>(capacity);
  const byType = new Map<string, NamedListener[]>();
  let errorDepth = 0;
  let idCounter = 0;

  function dispatch(ev: RalphEvent): void {
    const buckets: NamedListener[][] = [];
    const typed = byType.get(ev.type);
    if (typed && typed.length > 0) buckets.push(typed.slice());
    const wild = byType.get("*");
    if (wild && wild.length > 0) buckets.push(wild.slice());

    for (const list of buckets) {
      for (const sub of list) {
        try {
          sub.fn(ev);
        } catch (err) {
          handleSubError(sub.name, err);
        }
      }
    }
  }

  function handleSubError(consumer: string, err: unknown): void {
    if (errorDepth >= MAX_ERROR_DEPTH) return;
    errorDepth += 1;
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      const busErr: RalphEvent = {
        type: "__bus_error__",
        ts: Date.now(),
        consumer,
        error_message: e.message,
        ...(e.stack ? { error_stack: e.stack } : {}),
      };
      ring.push(busErr);
      dispatch(busErr);
    } finally {
      errorDepth -= 1;
    }
  }

  return {
    emit(input: EmitInput): void {
      const ev = { ts: Date.now(), ...input } as RalphEvent;
      ring.push(ev);
      dispatch(ev);
    },
    on<T extends RalphEventType>(
      type: T | "*",
      listener: Listener<Extract<RalphEvent, { type: T }>>,
    ): () => void {
      idCounter += 1;
      const name = `${type}#${idCounter}`;
      const entry: NamedListener = { name, fn: listener as Listener };
      const list = byType.get(type) ?? [];
      list.push(entry);
      byType.set(type, list);
      return () => {
        const cur = byType.get(type);
        if (!cur) return;
        const idx = cur.indexOf(entry);
        if (idx >= 0) cur.splice(idx, 1);
      };
    },
    snapshot(): RalphEvent[] {
      return ring.snapshot();
    },
  };
}

/** A no-op bus that satisfies the interface; used as a default when callers
 *  don't pass one. */
export function createNoopBus(): Bus {
  return {
    emit(): void {},
    on(): () => void {
      return () => {};
    },
    snapshot(): RalphEvent[] {
      return [];
    },
  };
}
