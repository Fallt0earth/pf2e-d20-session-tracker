// @ts-check
// CSV / JSON export of records. Pure: name maps come in as arguments.

export const CSV_COLUMNS = Object.freeze([
  "session", "time", "user", "actor", "alias", "natural", "kept", "formula", "total", "type", "stat", "dc", "outcome",
  "isReroll", "blind", "whispered", "source", "messageId", "id",
]);

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {import("../types.js").RollRecord[]} records
 * @param {{ users?: Record<string, string>, actors?: Record<string, string> }} [labels]
 */
export function recordsToCsv(records, labels = {}) {
  const users = labels.users ?? {}, actors = labels.actors ?? {};
  const rows = [CSV_COLUMNS.join(",")];
  const sorted = [...records].sort((a, b) => a.ts - b.ts || a.dieIndex - b.dieIndex);
  for (const r of sorted) {
    rows.push([
      r.sessionKey, new Date(r.ts).toISOString(), users[r.userId ?? ""] ?? r.userId ?? "", actors[r.actorId ?? ""] ?? r.actorId ?? "", r.alias,
      r.natural, r.kept, r.formula, r.total, r.type, r.stat ?? "", r.dc, r.outcome, r.isReroll, r.blind, r.whispered, r.source, r.msgId, r.id,
    ].map(cell).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * @param {import("../types.js").RollRecord[]} records
 * @param {{ users?: Record<string, string>, actors?: Record<string, string> }} [labels]
 */
export function recordsToJson(records, labels = {}) {
  const users = labels.users ?? {}, actors = labels.actors ?? {};
  const out = [...records].sort((a, b) => a.ts - b.ts || a.dieIndex - b.dieIndex).map((r) => ({
    ...r, userName: users[r.userId ?? ""] ?? null, actorName: actors[r.actorId ?? ""] ?? null, time: new Date(r.ts).toISOString(),
  }));
  return JSON.stringify(out, null, 1);
}
