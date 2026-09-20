// Foundry-side decoration of the fun model into template-ready lines (i18n, time formatting).
import { luckPercent } from "./tonight-decorate.js";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d));
const int = (v) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString());

/** "1 in N nights" text for a Monte Carlo placement, choosing the interesting tail. */
function rarity(stat, { high = true } = {}) {
  if (!stat) return "";
  const n = high ? stat.oneInHigh : stat.oneInLow;
  if (!n) return L("PF2E-D20.Fun.Unremarkable");
  return L("PF2E-D20.Fun.OneIn", { n: int(n) });
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** "3 vs 1.6 (P ≥ 0.10)" for an excess, "1 vs 5.5 (P ≤ 0.02)" for a drought. */
function faceLine(f) {
  if (!f) return "–";
  const excess = f.count >= f.expected;
  const p = excess ? f.pAtLeast : f.pAtMost;
  const chance = p === null || p === undefined ? "–" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`;
  const rate = f.rate === null || f.rate === undefined ? "" : ` · ${(f.rate * 100).toFixed(1)}%`;
  return `${f.count}${rate} (${L(excess ? "PF2E-D20.Fun.PAtLeast" : "PF2E-D20.Fun.PAtMost", { p: chance })})`;
}

function describeRecord(r) {
  const what = r.stat ? r.stat.replace(/-/g, " ") : r.type;
  const dc = r.dc !== null && r.dc !== undefined ? ` vs DC ${r.dc}` : "";
  return `${L("PF2E-D20.Fun.Nat")} ${r.natural} · ${what}${dc} · ${time(r.ts)}`;
}

/** @param {object} g  a group from buildFunModel (party or player) */
export function decorateFunGroup(g) {
  const s = g.streaks ?? {};
  const mc = g.mc?.stats ?? {};
  const streakLine = (run, label, statKey) => (run && run.length >= 2 ? { label, length: run.length, when: run.startTs ? `${time(run.startTs)}–${time(run.endTs)}` : "", rarity: rarity(mc[statKey], { high: true }), extra: run.face ? `(${run.face}s)` : "" } : null);
  const streaks = [
    streakLine(s.cold, L("PF2E-D20.Fun.ColdStreak"), "longestCold"),
    streakLine(s.hot, L("PF2E-D20.Fun.HotStreak"), "longestHot"),
    streakLine(s.sameFace, L("PF2E-D20.Fun.SameFace"), "maxFaceCount"),
    s.without20 && s.without20.length >= 10 ? { label: L("PF2E-D20.Fun.Without20"), length: s.without20.length, when: "", rarity: "", extra: "" } : null,
  ].filter(Boolean);
  const dos = g.dos ?? { n: 0 };
  const moments = [];
  if (g.moments?.clutch) moments.push({ label: L("PF2E-D20.Fun.Clutch"), text: describeRecord(g.moments.clutch) });
  if (g.moments?.heartbreaker) moments.push({ label: L("PF2E-D20.Fun.Heartbreaker"), text: describeRecord(g.moments.heartbreaker) });
  if (g.moments?.wasted20) moments.push({ label: L("PF2E-D20.Fun.Wasted20"), text: describeRecord(g.moments.wasted20) });
  const rerolls = g.rerolls ?? { count: 0 };
  const fortune = g.fortune ?? { fortune: { count: 0 }, misfortune: { count: 0 } };
  const maxHist = Math.max(1, ...(g.hist ?? [0]));
  return {
    id: g.id, label: g.label, subtitle: g.subtitle ?? "", n: g.n, band: g.band,
    bandLabel: L(`PF2E-D20.Band.${g.band}`),
    thin: g.luck.zGuard !== "ok",
    pips: int(g.basic?.sum), pipsRarity: mc.pips ? (mc.pips.percentile >= 0.5 ? rarity(mc.pips, { high: true }) : rarity(mc.pips, { high: false })) : "",
    pipsPercentile: mc.pips ? Math.round(mc.pips.percentile * 100) : null, pipsMedian: mc.pips ? int(mc.pips.median) : null,
    mean: fmt(g.basic?.mean), median: fmt(g.basic?.median, 1), modes: (g.basic?.modes ?? []).join(", "), sd: fmt(g.basic?.sd), min: g.basic?.min ?? "–", max: g.basic?.max ?? "–",
    z: g.luck.zGuard === "none" ? "–" : `${g.luck.z > 0 ? "+" : ""}${fmt(g.luck.z)}`,
    luckPct: luckPercent(g.luck),
    luckTitle: g.luck.zGuard === "none" ? L("PF2E-D20.Tonight.NoSample") : L("PF2E-D20.Tonight.LuckTitle", { pct: luckPercent(g.luck), z: `${g.luck.z > 0 ? "+" : ""}${fmt(g.luck.z)}` }),
    highPct: g.luck.high?.share === null || g.luck.high?.share === undefined ? "–" : `${Math.round(g.luck.high.share * 100)}%`,
    nat20: g.luck.nat20, nat1: g.luck.nat1,
    nat20Line: faceLine(g.luck.nat20),
    nat1Line: faceLine(g.luck.nat1),
    nat20When: s.nat20?.first >= 0 ? `${time(s.nat20.firstTs)}${s.nat20.last !== s.nat20.first ? ` → ${time(s.nat20.lastTs)}` : ""}` : "",
    missing: (g.missingFaces ?? []).join(", ") || L("PF2E-D20.Fun.None"),
    most: g.extremes ? `${g.extremes.most.join(", ")} (${g.extremes.mostCount}×)` : "–",
    least: g.extremes ? `${g.extremes.least.join(", ")} (${g.extremes.leastCount}×)` : "–",
    histBars: (g.hist ?? []).map((c, i) => ({ face: i + 1, count: c, pct: Math.round((c / maxHist) * 100) })),
    chisq: g.chisq?.bins ? L("PF2E-D20.Fun.ChiSquare", { bins: g.chisq.bins, stat: fmt(g.chisq.stat, 1), p: fmt(g.chisq.p, 2) }) : L("PF2E-D20.Fun.ChiSquareNA"),
    dos: dos.n ? { n: dos.n, cs: dos.criticalSuccess, s: dos.success, f: dos.failure, cf: dos.criticalFailure, csPct: pct(dos.criticalSuccess, dos.n), sPct: pct(dos.success, dos.n), fPct: pct(dos.failure, dos.n), cfPct: pct(dos.criticalFailure, dos.n) } : null,
    streaks, moments,
    rerolls: rerolls.count ? { count: rerolls.count, netGain: (rerolls.netGain >= 0 ? "+" : "") + rerolls.netGain, best: rerolls.best ? `${rerolls.best.gain >= 0 ? "+" : ""}${rerolls.best.gain} (${rerolls.best.discarded} → ${rerolls.best.kept})` : "–", approx: rerolls.list.some((x) => !x.exact) } : null,
    fortune: (fortune.fortune.count || fortune.misfortune.count) ? { fortune: fortune.fortune.count, fortuneGain: fmt(fortune.fortune.avgGain, 1), misfortune: fortune.misfortune.count, misfortuneLoss: fmt(fortune.misfortune.avgLoss, 1) } : null,
    byStat: Object.entries(g.byStat ?? {}).slice(0, 8).map(([stat, v]) => ({ stat: stat.replace(/-/g, " "), n: v.n, mean: fmt(v.mean, 1) })),
  };
}

export function decorateAwards(list, groupsById) {
  return list.map((a) => {
    const g = groupsById.get(a.groupId);
    const data = { who: a.label, value: a.value, n: g?.n ?? "", z: g ? fmt(g.luck.z) : "", pct: g ? (luckPercent(g.luck) ?? "–") : "", sd: g ? fmt(g.basic?.sd) : "", count: a.key === "snakeEyes" ? g?.luck.nat1.count : a.key === "golden" ? g?.luck.nat20.count : "", band: g ? L(`PF2E-D20.Band.${g.band}`) : "" };
    return { key: a.key, title: L(`PF2E-D20.Awards.${a.key}.Title`), text: L(`PF2E-D20.Awards.${a.key}.Text`, data), ties: a.ties };
  });
}
