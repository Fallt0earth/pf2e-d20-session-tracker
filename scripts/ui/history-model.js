// @ts-check
// Pure model for the History tab: per-group luck by evening, cumulative delta, all-time rank, best and
// worst evening. Same visibility/count/grouping rules as the other tabs.
import { countedRecords, groupRecords } from "./view-model.js";
import { luckSummary, zBand } from "../stats/luck.js";
import { campaignTrend } from "../stats/summarize.js";

/**
 * @param {Array<{ key: string, label: string, records: import("../types.js").RollRecord[] }>} sessions  chronological, excluded evenings already removed
 * @param {import("./view-model.js").ViewOptions} opts
 */
export function buildHistoryModel(sessions, opts) {
  const groups = new Map();
  const rows = [];
  const partySessions = [];
  for (const s of sessions) {
    const counted = countedRecords(s.records, opts);
    if (!counted.length) continue;
    const grouped = groupRecords(counted, opts);
    const naturals = counted.map((r) => r.natural);
    const party = luckSummary(naturals);
    const row = { key: s.key, label: s.label, n: counted.length, party: { ...party, band: zBand(party.zGuard === "none" ? null : party.z) }, cells: {} };
    for (const g of grouped.values()) {
      if (!groups.has(g.id)) groups.set(g.id, { id: g.id, label: g.label, sessions: [] });
      const nats = g.records.map((r) => r.natural);
      groups.get(g.id).sessions.push({ key: s.key, naturals: nats });
      const l = luckSummary(nats);
      row.cells[g.id] = { n: l.n, z: l.z, mean: l.mean, zGuard: l.zGuard, band: zBand(l.zGuard === "none" ? null : l.z) };
    }
    rows.push(row);
    partySessions.push({ key: s.key, naturals });
  }
  const trends = [...groups.values()].map((g) => {
    const t = campaignTrend(g.sessions);
    const nat20Rate = t.allTime.n ? t.allTime.nat20.count / t.allTime.n : null;
    return { id: g.id, label: g.label, ...t, nat20Rate, band: zBand(t.allTime.zGuard === "none" ? null : t.allTime.z), evenings: g.sessions.length };
  });
  trends.sort((a, b) => (b.allTime.zGuard !== "none" ? b.allTime.z : -Infinity) - (a.allTime.zGuard !== "none" ? a.allTime.z : -Infinity) || b.allTime.n - a.allTime.n);
  const party = campaignTrend(partySessions);
  return { sessions: rows, groups: trends, party: { ...party, band: zBand(party.allTime.zGuard === "none" ? null : party.allTime.z) }, empty: rows.length === 0 };
}
