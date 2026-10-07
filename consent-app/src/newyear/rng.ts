/**
 * Random numbers for the New Year break. Everything that is shuffled (fun
 * names, digit sequences, the oddball order and timings) takes a generator,
 * so tests and the example leaderboard can use a fixed seed and get the same
 * result every time, while real use gets a fresh seed.
 */
export type Rng = () => number;

/** Mulberry32: a small, fast, seedable generator with a 2^32 period. Not for anything secret. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 32-bit seed, from the browser's cryptographic generator where there is one. */
export function randomSeed(): number {
  try {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0];
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}

/** A whole number from min to max, both included. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One item of a list, chosen evenly. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}
