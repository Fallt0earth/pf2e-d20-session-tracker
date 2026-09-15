// @ts-check
// Descriptive statistics over arrays of naturals (1–20). Pure.

/** Counts per face: index 0 = face 1 … index 19 = face 20. Non-integer or out-of-range values are ignored. */
export function histogram(naturals) {
  const h = new Array(20).fill(0);
  for (const v of naturals) if (Number.isInteger(v) && v >= 1 && v <= 20) h[v - 1]++;
  return h;
}

/** Faces (1–20) that never came up. */
export function missingFaces(hist) {
  const out = [];
  hist.forEach((c, i) => { if (c === 0) out.push(i + 1); });
  return out;
}

/** The most- and least-rolled faces (ties kept, ascending). */
export function extremeFaces(hist) {
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const most = [], least = [];
  hist.forEach((c, i) => { if (c === max) most.push(i + 1); if (c === min) least.push(i + 1); });
  return { most, mostCount: max, least, leastCount: min };
}

/**
 * n, sum, mean, median, mode(s), min, max and sample standard deviation (n − 1; null when n < 2).
 * @param {number[]} values
 */
export function describe(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { n: 0, sum: 0, mean: null, median: null, modes: [], min: null, max: null, sd: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const counts = new Map();
  for (const v of sorted) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const modes = [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v);
  const sd = n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  return { n, sum, mean, median, modes, min: sorted[0], max: sorted[n - 1], sd };
}
