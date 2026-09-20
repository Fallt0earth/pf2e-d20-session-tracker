// @ts-check
// The point of the module (SCOPE §4.3): luck = the natural die only, measured against a fair d20.
//   delta = mean − 10.5 ; z = delta / (5.766 / √n) ; percentile = Φ(z)
// Nat 20 / Nat 1 counts are compared with n/20 and given exact binomial tails. Sample-size honesty is
// data (`zGuard`), rendered by the UI: "none" below minN (hide z), "thin" below thinN (grey it out).

import { D20 } from "../constants.js";
import { normalCdf } from "./normal.js";
import { binomialAtLeast, binomialAtMost } from "./binomial.js";

export const DEFAULT_GUARDS = Object.freeze({ minN: 5, thinN: 15 });

/**
 * @param {number[]} naturals  Physical die results to count (already filtered by count mode).
 * @param {{minN?: number, thinN?: number}} [guards]
 */
export function luckSummary(naturals, guards = DEFAULT_GUARDS) {
  const xs = naturals.filter((v) => Number.isInteger(v) && v >= 1 && v <= 20);
  const n = xs.length;
  const minN = guards.minN ?? DEFAULT_GUARDS.minN;
  const thinN = guards.thinN ?? DEFAULT_GUARDS.thinN;
  if (n === 0) {
    return { n: 0, mean: null, delta: null, z: null, percentile: null, zGuard: "none", high: { count: 0, share: null, expected: 0.5 }, nat20: faceStats(0, 0), nat1: faceStats(0, 0) };
  }
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const delta = mean - D20.mean;
  const z = delta / (D20.sd / Math.sqrt(n));
  const zGuard = n < minN ? "none" : n < thinN ? "thin" : "ok";
  const highCount = xs.filter((v) => v >= 11).length;
  return {
    n, mean, delta, z, percentile: normalCdf(z), zGuard,
    // The human-readable layer: share of "high" rolls (11–20; a fair die gives 50%).
    high: { count: highCount, share: highCount / n, expected: 0.5 },
    nat20: faceStats(n, xs.filter((v) => v === 20).length),
    nat1: faceStats(n, xs.filter((v) => v === 1).length),
  };
}

/** Observed vs expected count of one face (rate against the fair 5%), with both one-sided binomial tails. */
export function faceStats(n, count) {
  const p = 1 / 20;
  return {
    count,
    expected: n * p,
    rate: n ? count / n : null,
    pAtLeast: n ? binomialAtLeast(n, count, p) : null, // excess
    pAtMost: n ? binomialAtMost(n, count, p) : null,   // drought
  };
}

/** Human bucket for a z value (SCOPE §4.3): noise / noticeable / genuinely hot or cold. */
export function zBand(z) {
  if (z === null || !Number.isFinite(z)) return "none";
  const a = Math.abs(z);
  if (a < 1) return "noise";
  if (a < 2) return z > 0 ? "hot" : "cold";
  return z > 0 ? "blessed" : "cursed";
}
