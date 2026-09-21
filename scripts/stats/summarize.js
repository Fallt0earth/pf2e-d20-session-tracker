// @ts-check
// Full "fun" summary of one group's records (docs/PLAN.md §4.6 GroupSummary) and the campaign view.
import { luckSummary, zBand } from "./luck.js";
import { histogram, describe, missingFaces, extremeFaces } from "./basic.js";
import { streakSummary } from "./streaks.js";
import { dosSplit, moments } from "./dos.js";
import { heroPointStats, fortuneStats } from "./rerolls.js";
import { chiSquareUniform } from "./chisq.js";
import { mcSummary } from "./montecarlo.js";

/**
 * @param {import("../types.js").RollRecord[]} records   one group's counted records (already filtered)
 * @param {{ mc?: { iterations?: number, seed?: number|string } | false }} [opts]
 */
export function groupSummary(records, opts = {}) {
  const ordered = [...records].sort((a, b) => a.ts - b.ts || a.dieIndex - b.dieIndex);
  const naturals = ordered.map((r) => r.natural).filter((v) => Number.isInteger(v));
  const timestamps = ordered.filter((r) => Number.isInteger(r.natural)).map((r) => r.ts);
  const hist = histogram(naturals);
  const luck = luckSummary(naturals);
  // Maps, not objects: the keys are strings that came out of chat messages ("constructor" is a valid slug).
  const byType = new Map(), byStat = new Map();
  const tally = (map, key, natural) => {
    const t = map.get(key) ?? { n: 0, sum: 0 };
    t.n++; t.sum += natural;
    map.set(key, t);
  };
  for (const r of ordered) {
    if (!Number.isInteger(r.natural)) continue;
    tally(byType, String(r.type), r.natural);
    if (typeof r.stat === "string" && r.stat) tally(byStat, r.stat, r.natural);
  }
  const finish = (map) => Object.fromEntries([...map].map(([k, v]) => [k, { n: v.n, mean: v.n ? v.sum / v.n : null }]).sort((a, b) => b[1].n - a[1].n));
  return {
    n: naturals.length,
    luck,
    band: zBand(luck.zGuard === "none" ? null : luck.z),
    basic: describe(naturals),
    hist,
    missingFaces: missingFaces(hist),
    extremes: extremeFaces(hist),
    streaks: streakSummary(naturals, timestamps),
    dos: dosSplit(ordered),
    moments: moments(ordered),
    rerolls: heroPointStats(ordered),
    fortune: fortuneStats(ordered),
    chisq: chiSquareUniform(hist),
    mc: opts.mc === false ? null : mcSummary(naturals, opts.mc ?? {}),
    byType: finish(byType),
    byStat: finish(byStat),
  };
}

/**
 * Campaign trend for one group across sessions.
 * @param {Array<{ key: string, naturals: number[] }>} sessions   chronological
 */
export function campaignTrend(sessions) {
  let cumN = 0, cumSum = 0;
  const points = sessions.map((s) => {
    const l = luckSummary(s.naturals);
    cumN += l.n; cumSum += s.naturals.reduce((a, b) => a + b, 0);
    return { key: s.key, n: l.n, z: l.z, percentile: l.percentile, mean: l.mean, zGuard: l.zGuard, cumulativeDelta: cumN ? cumSum / cumN - 10.5 : null };
  });
  const all = sessions.flatMap((s) => s.naturals);
  const allTime = luckSummary(all);
  const scored = points.filter((p) => p.zGuard !== "none" && p.z !== null);
  const best = scored.length ? scored.reduce((a, b) => (b.z > a.z ? b : a)) : null;
  const worst = scored.length ? scored.reduce((a, b) => (b.z < a.z ? b : a)) : null;
  return { points, allTime, best, worst };
}
