// Seeded deterministic RNG. The state is a single uint32 stored in GameState.rng so a save
// replays exactly. `random(n)` mirrors Lingo semantics: an integer in 1..n.

export interface RngHolder {
  rng: number;
}

/** mulberry32 step: advances holder.rng and returns a float in [0, 1). */
export function nextFloat(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Lingo `random(n)`: 1..n inclusive. */
export function random(h: RngHolder, n: number): number {
  if (n < 1) return 1;
  return 1 + Math.floor(nextFloat(h) * n);
}

/** Normalise any number/string seed into a uint32 state. */
export function seedFrom(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
