// Analyzer entry (M0). Bundled by dev/build-macro.mjs into macros/analyze.js, a single-file Script
// macro that runs on any Foundry client with no module installed. It validates the normalizer against
// real messages: buckets the last N days of game.messages into evenings, prints a luck leaderboard per
// evening and a coverage report of message kinds. Read-only apart from the optional GM whisper.
//
//   Re-run with options from the console after the macro has executed once:
//   d20Analyze({ days: 30, whisper: true, countMode: "kept" })

import { messageToRollRecords, classifyMessage } from "./capture/normalize.js";
import { sessionKeyFor, sessionLabel, compareKeys, DEFAULT_TIMEZONE, DEFAULT_BOUNDARY_HOUR } from "./sessions/bucket.js";
import { luckSummary } from "./stats/luck.js";
import { histogram } from "./stats/basic.js";

const TAG = "d20 tracker";

export async function analyze({
  days = 14,
  timezone = DEFAULT_TIMEZONE,
  boundaryHour = DEFAULT_BOUNDARY_HOUR,
  countMode = "all",      // "all" physical dice, or "kept" only
  includeRaw = true,
  includeBlind = true,
  groupBy = "user",       // "user" | "actor"
  whisper = false,        // post the latest evening's table to the GM as a whisper
  minRolls = 1,           // hide evenings with fewer dice
} = {}) {
  const since = Date.now() - days * 86_400_000;
  const messages = game.messages.contents.filter((m) => m.timestamp >= since).map((m) => m.toObject());
  const ctx = { sessionKeyFor: (ts) => sessionKeyFor(ts, { timezone, boundaryHour }), event: "backfill", captureRawRolls: includeRaw };

  // Tallies are keyed by strings read out of chat messages: objects without a prototype.
  const coverage = Object.create(null);
  const records = [];
  for (const m of messages) {
    const kind = classifyMessage(m) ?? (m.rolls?.length ? "roll-without-d20" : "no-roll");
    coverage[kind] = (coverage[kind] ?? 0) + 1;
    records.push(...messageToRollRecords(m, ctx));
  }
  const counted = records.filter((r) => r.natural !== null && (countMode === "all" || r.kept) && (includeBlind || !(r.blind || r.whispered)));

  const label = (id) => groupBy === "actor"
    ? (game.actors.get(id)?.name ?? counted.find((r) => r.actorId === id)?.alias ?? String(id))
    : (game.users.get(id)?.name ?? String(id));
  const keyOf = (r) => (groupBy === "actor" ? r.actorId : r.userId) ?? "unknown";

  const evenings = Object.create(null);
  for (const r of counted) (evenings[r.sessionKey] ??= []).push(r);
  const keys = Object.keys(evenings).sort(compareKeys);
  const tables = Object.create(null);
  for (const key of keys) {
    const recs = evenings[key];
    if (recs.length < minRolls) continue;
    const groups = Object.create(null);
    for (const r of recs) (groups[keyOf(r)] ??= []).push(r.natural);
    const rows = Object.entries(groups).map(([id, naturals]) => {
      const s = luckSummary(naturals);
      return {
        who: label(id), n: s.n, mean: round(s.mean, 2), delta: round(s.delta, 2), z: round(s.z, 2),
        pct: s.percentile === null ? null : Math.round(s.percentile * 100),
        nat20: `${s.nat20.count} vs ${s.nat20.expected.toFixed(1)}`, nat1: `${s.nat1.count} vs ${s.nat1.expected.toFixed(1)}`,
        guard: s.zGuard, hist: histogram(naturals).join(" "),
      };
    }).sort((a, b) => (b.z ?? -99) - (a.z ?? -99));
    const party = luckSummary(recs.map((r) => r.natural));
    tables[key] = { rows, party: { n: party.n, mean: round(party.mean, 2), z: round(party.z, 2), pct: party.percentile === null ? null : Math.round(party.percentile * 100) } };
    console.group(`${TAG} | ${sessionLabel(key)} — ${recs.length} dice, party mean ${tables[key].party.mean}, party z ${tables[key].party.z}`);
    console.table(rows);
    console.groupEnd();
  }
  console.log(`${TAG} | coverage over ${messages.length} messages in the last ${days} days:`, coverage);
  console.log(`${TAG} | ${records.length} d20 records, ${counted.length} counted (${countMode}); evenings: ${keys.join(", ") || "none"}`);
  console.log(`${TAG} | records by source:`, countBy(records, (r) => r.source), "| by type:", countBy(records, (r) => r.type));

  if (whisper && keys.length) {
    const key = keys[keys.length - 1];
    const t = tables[key];
    // Names and aliases are typed by players: everything that goes into the whisper is escaped.
    const html = `<h3>${TAG}: ${esc(sessionLabel(key))}</h3><p>${esc(t.party.n)} dice, party mean ${esc(t.party.mean)}, z ${esc(t.party.z)}</p>` +
      `<table><tr><th>who</th><th>n</th><th>mean</th><th>z</th><th>nat20</th><th>nat1</th></tr>` +
      t.rows.map((r) => `<tr><td>${esc(r.who)}</td><td>${esc(r.n)}</td><td>${esc(r.mean)}</td><td>${esc(r.guard === "ok" ? r.z : `(${r.z})`)}</td><td>${esc(r.nat20)}</td><td>${esc(r.nat1)}</td></tr>`).join("") + `</table>`;
    await ChatMessage.create({ content: html, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
  }
  return { coverage, tables, records, counted: counted.length };
}

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function round(v, d) { return v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)); }
function countBy(arr, fn) { const o = Object.create(null); for (const x of arr) { const k = fn(x); o[k] = (o[k] ?? 0) + 1; } return o; }

globalThis.d20Analyze = analyze;
analyze();
