// @ts-check
// Hero-point rerolls and fortune/misfortune pairs. A reroll is two physical dice under two message ids
// when the roller-side enrichment was present (original record has `rerolledBy`, the new die has
// `rerollOf`), or two records under the reroll message id when recovered from HTML (kept + `:html:`).

/** @param {import("../types.js").RollRecord[]} records */
export function heroPointStats(records) {
  const byMsg = new Map();
  for (const r of records) { if (!byMsg.has(r.msgId)) byMsg.set(r.msgId, []); byMsg.get(r.msgId).push(r); }
  const list = [];
  const seen = new Set();
  for (const r of records) {
    // Enriched pair: new die carries rerollOf.
    if (r.rerollOf && !seen.has(r.msgId)) {
      seen.add(r.msgId);
      const original = (byMsg.get(r.rerollOf) ?? []).find((x) => x.rerolledBy === r.msgId) ?? null;
      const kept = r.kept ? r : original;
      const discarded = r.kept ? original : r;
      if (kept && discarded) list.push({ msgId: r.msgId, original: original?.natural ?? null, fresh: r.natural, kept: kept.natural, discarded: discarded.natural, gain: kept.natural - (original?.natural ?? discarded.natural), exact: !!original, resource: r.resource ?? null, ts: r.ts });
      continue;
    }
    // HTML-recovered pair: kept die + :html: discard under the same reroll message; which was the original is unknown.
    if (r.isReroll && r.source === "pf2e-check" && r.kept && !seen.has(r.msgId)) {
      const html = (byMsg.get(r.msgId) ?? []).find((x) => x.source === "reroll-html");
      if (html) {
        seen.add(r.msgId);
        list.push({ msgId: r.msgId, original: null, fresh: null, kept: r.natural, discarded: html.natural, gain: html.natural === null ? null : r.natural - html.natural, exact: false, resource: null, ts: r.ts });
      }
    }
  }
  const gains = list.map((x) => x.gain).filter((g) => g !== null);
  const best = list.filter((x) => x.gain !== null).sort((a, b) => b.gain - a.gain)[0] ?? null;
  return { count: list.length, netGain: gains.reduce((s, g) => s + g, 0), best, list };
}

/**
 * Fortune (2d20kh) and misfortune (2d20kl): pairs by message, kept vs discarded.
 * @param {import("../types.js").RollRecord[]} records
 */
export function fortuneStats(records) {
  const byMsg = new Map();
  for (const r of records) {
    if (!/^2d20k[hl]$/.test(r.formula ?? "") || r.natural === null) continue;
    if (!byMsg.has(r.msgId)) byMsg.set(r.msgId, []);
    byMsg.get(r.msgId).push(r);
  }
  const fortune = [], misfortune = [];
  for (const pair of byMsg.values()) {
    const kept = pair.find((r) => r.kept), dropped = pair.find((r) => !r.kept);
    if (!kept || !dropped) continue;
    (kept.formula.endsWith("kh") ? fortune : misfortune).push({ kept: kept.natural, dropped: dropped.natural, diff: kept.natural - dropped.natural, msgId: kept.msgId });
  }
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    fortune: { count: fortune.length, avgGain: mean(fortune.map((p) => p.diff)), list: fortune },
    misfortune: { count: misfortune.length, avgLoss: mean(misfortune.map((p) => -p.diff)), list: misfortune },
  };
}
