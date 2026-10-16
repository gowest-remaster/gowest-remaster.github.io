// Minimal typed event emitter.
export class Emitter<E extends Record<string, unknown[]>> {
  private map = new Map<keyof E, Set<(...a: never[]) => void>>();
  on<K extends keyof E>(k: K, fn: (...a: E[K]) => void): () => void {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as unknown as (...a: never[]) => void);
    return () => s!.delete(fn as unknown as (...a: never[]) => void);
  }
  emit<K extends keyof E>(k: K, ...a: E[K]) {
    for (const fn of [...(this.map.get(k) ?? [])]) {
      try {
        (fn as unknown as (...a: E[K]) => void)(...a);
      } catch (e) {
        console.error(`listener for ${String(k)} failed`, e);
      }
    }
  }
}
