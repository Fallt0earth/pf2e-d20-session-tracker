// @ts-check
// Seeded PRNG for the Monte Carlo layer: mulberry32 (public domain, 32-bit state, plenty for dice).
// Seeding by a string (the session key) keeps "1 in N nights" labels stable between renders.
// Never route simulations through Foundry's Roll (Dice So Nice would animate them, chat would fill).

/** FNV-1a 32-bit hash of a string → uint32 seed. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** @param {number|string} seed */
export function mulberry32(seed) {
  let a = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fair d20 from a [0,1) generator. */
export function d20(rng) {
  return 1 + Math.floor(rng() * 20);
}
