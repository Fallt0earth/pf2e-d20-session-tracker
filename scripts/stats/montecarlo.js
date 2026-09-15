// @ts-check
// Monte Carlo null distribution (SCOPE §4.5): simulate K fair sessions with the same number of dice,
// compute every "fun" statistic on each, and report where the observed value sits. One loop per
// iteration computes all statistics at once, so 10 000 sessions of 600 dice cost ~6M draws.

import { mulberry32, d20 } from "./rng.js";
import { HOT_MIN, COLD_MAX } from "./streaks.js";

export const MC_STATS = Object.freeze(["pips", "longestCold", "longestHot", "maxFaceCount", "firstNat20", "nat20s", "nat1s", "distinctFaces"]);

/**
 * Compute the tracked statistics for one sequence of naturals.
 * @param {ArrayLike<number>} dice
 */
export function observedStats(dice) {
  const n = dice.length;
  let pips = 0, cold = 0, hot = 0, bestCold = 0, bestHot = 0, firstNat20 = -1, nat20s = 0, nat1s = 0;
  const faces = new Int32Array(20);
  for (let i = 0; i < n; i++) {
    const v = dice[i];
    pips += v;
    faces[v - 1]++;
    if (v === 20) { nat20s++; if (firstNat20 < 0) firstNat20 = i; }
    if (v === 1) nat1s++;
    if (v <= COLD_MAX) { cold++; if (cold > bestCold) bestCold = cold; } else cold = 0;
    if (v >= HOT_MIN) { hot++; if (hot > bestHot) bestHot = hot; } else hot = 0;
  }
  let maxFaceCount = 0, distinctFaces = 0;
  for (let f = 0; f < 20; f++) { if (faces[f] > maxFaceCount) maxFaceCount = faces[f]; if (faces[f] > 0) distinctFaces++; }
  return { pips, longestCold: bestCold, longestHot: bestHot, maxFaceCount, firstNat20: firstNat20 < 0 ? n : firstNat20, nat20s, nat1s, distinctFaces };
}

/**
 * Simulate `iterations` fair sessions of `n` dice; returns sorted samples per statistic.
 * @param {number} n
 * @param {{ iterations?: number, seed?: number|string }} [opts]
 * @returns {Record<string, Float64Array>}
 */
export function simulate(n, { iterations = 10_000, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const samples = Object.fromEntries(MC_STATS.map((k) => [k, new Float64Array(iterations)]));
  const dice = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) dice[i] = d20(rng);
    const s = observedStats(dice);
    for (const k of MC_STATS) samples[k][it] = s[k];
  }
  for (const k of MC_STATS) samples[k].sort();
  return samples;
}

/**
 * Where `value` sits in a sorted sample: fraction below, fraction at or above, fraction at or below.
 * @param {Float64Array} sorted
 * @param {number} value
 */
export function locate(sorted, value) {
  const k = sorted.length;
  if (!k) return { percentile: null, pAtLeast: null, pAtMost: null };
  let lo = 0, hi = k;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  const below = lo;
  let lo2 = 0, hi2 = k;
  while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sorted[mid] <= value) lo2 = mid + 1; else hi2 = mid; }
  const atOrBelow = lo2;
  return { percentile: (below + (atOrBelow - below) / 2) / k, pAtLeast: (k - below) / k, pAtMost: atOrBelow / k };
}

/** "1 in N nights" from a tail probability; null when it is not rare at all. */
export function oneIn(p) {
  if (p === null || p <= 0) return null;
  if (p >= 0.5) return null;
  return Math.round(1 / p);
}

/**
 * Observed statistics of `naturals` with their Monte Carlo placement.
 * @param {number[]} naturals
 * @param {{ iterations?: number, seed?: number|string }} [opts]
 */
export function mcSummary(naturals, opts = {}) {
  const n = naturals.length;
  if (n === 0) return { n: 0, iterations: 0, stats: {} };
  const iterations = opts.iterations ?? 10_000;
  const observed = observedStats(naturals);
  const sims = simulate(n, { iterations, seed: opts.seed ?? 1 });
  const stats = {};
  // A tail of exactly 0 means "rarer than anything in K simulated nights": report it as 1 in (K+1).
  const floor = (p) => (p === null ? null : Math.max(p, 1 / (iterations + 1)));
  for (const k of MC_STATS) {
    const loc = locate(sims[k], observed[k]);
    stats[k] = { observed: observed[k], ...loc, oneInHigh: oneIn(floor(loc.pAtLeast)), oneInLow: oneIn(floor(loc.pAtMost)), median: sims[k][Math.floor(iterations / 2)] };
  }
  return { n, iterations, stats };
}
