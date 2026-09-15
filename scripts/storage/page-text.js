// Human-readable page text for the hidden log: a GM opening the journal sees a table, not a blob.
import { luckSummary } from "../stats/luck.js";
import { sessionLabel } from "../sessions/bucket.js";

const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * @param {string} key
 * @param {import("../types.js").RollRecord[]} records
 * @param {{ label?: string, excluded?: boolean }} meta
 */
export function pageSummaryHtml(key, records, meta = {}) {
  const byUser = new Map();
  for (const r of records) { if (r.natural === null) continue; const id = r.userId ?? "unknown"; if (!byUser.has(id)) byUser.set(id, []); byUser.get(id).push(r.natural); }
  const party = luckSummary(records.map((r) => r.natural).filter((v) => v !== null));
  const rows = [...byUser.entries()].map(([id, nats]) => ({ name: game.users.get(id)?.name ?? id, l: luckSummary(nats) })).sort((a, b) => (b.l.z ?? -99) - (a.l.z ?? -99));
  return `<h2>${esc(meta.label || sessionLabel(key))}${meta.excluded ? " (excluded)" : ""}</h2>
<p>${party.n} dice, mean ${fmt(party.mean)}, luck z ${fmt(party.z)}. Recorded by PF2e d20 Session Tracker; the data lives in this page's flags.</p>
<table><thead><tr><th>Player</th><th>Dice</th><th>Mean</th><th>Luck z</th><th>Nat 20</th><th>Nat 1</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.l.n}</td><td>${fmt(r.l.mean)}</td><td>${r.l.zGuard === "none" ? "–" : fmt(r.l.z)}</td><td>${r.l.nat20.count}</td><td>${r.l.nat1.count}</td></tr>`).join("\n")}
</tbody></table>`;
}
