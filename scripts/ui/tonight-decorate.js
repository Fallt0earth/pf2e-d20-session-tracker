// Foundry-side decoration of view-model rows into the human-readable first layer (percentages, a luck
// meter, plain sentences) with the statistical detail (z-score, exact percentile, binomial tails) kept
// one level down. Shared by the tracker window and the report popup.
const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d));
const signed = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`);
const pct1 = (rate) => (rate === null || rate === undefined ? "–" : `${(rate * 100).toFixed(1)}%`);

/** Luck percentile as a whole percent, or null when the sample is too small to say anything. */
export function luckPercent(luck) {
  if (!luck || luck.zGuard === "none" || luck.percentile === null) return null;
  return Math.max(1, Math.min(99, Math.round(luck.percentile * 100)));
}

/** Geometry of the meter: a bar growing from the 50% centre line toward the value. */
export function meterFor(pct) {
  if (pct === null) return null;
  return pct >= 50 ? { left: 50, width: Math.max(1, pct - 50), side: "hot" } : { left: pct, width: Math.max(1, 50 - pct), side: "cold" };
}

function faceDetail(f) {
  if (!f || f.rate === null) return "–";
  const excess = f.count >= f.expected;
  const p = excess ? f.pAtLeast : f.pAtMost;
  return L("PF2E-D20.Details.Face", { count: f.count, expected: fmt(f.expected, 1), tail: excess ? "≥" : "≤", p: fmt(p, 2) });
}

/**
 * @param {object} r            a row (or the party) from buildSessionModel
 * @param {{ expanded?: boolean }} [state]
 */
export function decorateRow(r, { expanded = false } = {}) {
  const luck = r.luck;
  const none = luck.zGuard === "none";
  const thin = luck.zGuard === "thin";
  const luckPct = luckPercent(luck);
  const maxHist = Math.max(1, ...(r.hist ?? [0]));
  return {
    ...r,
    expanded, none, thin,
    bandLabel: L(`PF2E-D20.Band.${r.band}`),
    luckPct,
    luckText: luckPct === null ? L("PF2E-D20.Tonight.TooFew") : `${luckPct}%`,
    luckTitle: luckPct === null ? L("PF2E-D20.Tonight.NoSample") : L("PF2E-D20.Tonight.LuckTitle", { pct: luckPct, z: signed(luck.z) }) + (thin ? ` ${L("PF2E-D20.Tonight.ThinSample")}` : ""),
    meter: meterFor(luckPct),
    average: fmt(luck.mean, 1),
    averageDelta: signed(luck.delta, 1),
    highPct: luck.high?.share === null || luck.high?.share === undefined ? "–" : `${Math.round(luck.high.share * 100)}%`,
    nat20Text: luck.n ? `${luck.nat20.count} · ${pct1(luck.nat20.rate)}` : "–",
    nat1Text: luck.n ? `${luck.nat1.count} · ${pct1(luck.nat1.rate)}` : "–",
    details: none && !luck.n ? [] : [
      { label: L("PF2E-D20.Details.ZScore"), value: none ? "–" : signed(luck.z) },
      { label: L("PF2E-D20.Details.Percentile"), value: luck.percentile === null || none ? "–" : `${(luck.percentile * 100).toFixed(1)}%` },
      { label: L("PF2E-D20.Details.Average"), value: `${fmt(luck.mean)} (${signed(luck.delta)} ${L("PF2E-D20.Details.VsFair")})` },
      { label: L("PF2E-D20.Details.High"), value: `${luck.high?.count ?? 0} / ${luck.n}` },
      { label: L("PF2E-D20.Tonight.Nat20"), value: faceDetail(luck.nat20) },
      { label: L("PF2E-D20.Tonight.Nat1"), value: faceDetail(luck.nat1) },
    ],
    histBars: (r.hist ?? []).map((c, i) => ({ face: i + 1, count: c, pct: Math.round((c / maxHist) * 100) })),
    types: Object.entries(r.byType ?? {}).sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n })),
  };
}

/** One plain sentence for the party headline. */
export function partySentence(party) {
  const luck = party.luck;
  if (!luck.n) return L("PF2E-D20.Tonight.NoRolls");
  const pct = luckPercent(luck);
  const base = L("PF2E-D20.Tonight.PartyRolled", { n: luck.n, mean: fmt(luck.mean, 1) });
  if (pct === null) return `${base} ${L("PF2E-D20.Tonight.NoSample")}`;
  return `${base} ${L("PF2E-D20.Tonight.PartyLuck", { pct, band: L(`PF2E-D20.Band.${party.band}`) })}`;
}
