export interface VirtualClock {
  now(): Date;
  advance(ms: number): void;
  tick(): Promise<void>;
}

export function createVirtualClock(start: Date): VirtualClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
    tick: async () => {
      // Drain pending microtasks so awaiters can run before inspection.
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
    },
  };
}
