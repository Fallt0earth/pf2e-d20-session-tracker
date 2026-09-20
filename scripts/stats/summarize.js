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
  const byType = {}, byStat = {};
  for (const r of ordered) {
    if (!Number.isInteger(r.natural)) continue;
    (byType[r.type] ??= { n: 0, sum: 0 }).n++; byType[r.type].sum += r.natural;
    const stat = r.stat ?? null;
    if (stat) { (byStat[stat] ??= { n: 0, sum: 0 }).n++; byStat[stat].sum += r.natural; }
  }
  const finish = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { n: v.n, mean: v.n ? v.sum / v.n : null }]).sort((a, b) => b[1].n - a[1].n));
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
