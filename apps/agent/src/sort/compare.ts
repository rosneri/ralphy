/** Standard comparator: negative if a<b, positive if a>b, 0 otherwise. */
export type Comparator<T> = (a: T, b: T) => number;

/** Compose comparators: the first non-zero result wins. Empty chain is a stable no-op. */
export function chain<T>(...cmps: Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}
