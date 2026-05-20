/**
 * Fixed-capacity FIFO ring buffer. push() overwrites the oldest entry
 * when full; snapshot() returns chronologically ordered entries.
 */
export interface Ring<T> {
  push(value: T): void;
  snapshot(): T[];
  clear(): void;
}

export function createRing<T>(capacity: number): Ring<T> {
  if (capacity <= 0) throw new Error("ring capacity must be > 0");
  const buf: (T | undefined)[] = Array.from({ length: capacity });
  let head = 0;
  let size = 0;

  return {
    push(value: T): void {
      buf[head] = value;
      head = (head + 1) % capacity;
      if (size < capacity) size += 1;
    },
    snapshot(): T[] {
      const out: T[] = Array.from({ length: size });
      const start = size < capacity ? 0 : head;
      for (let i = 0; i < size; i++) {
        const slot = (start + i) % capacity;
        out[i] = buf[slot] as T;
      }
      return out;
    },
    clear(): void {
      for (let i = 0; i < capacity; i++) buf[i] = undefined;
      head = 0;
      size = 0;
    },
  };
}
