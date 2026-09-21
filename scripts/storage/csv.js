// @ts-check
// CSV / JSON export of records. Pure: name maps come in as arguments.

export const CSV_COLUMNS = Object.freeze([
  "session", "time", "user", "actor", "alias", "natural", "kept", "formula", "total", "type", "stat", "dc", "outcome",
  "isReroll", "blind", "whispered", "source", "messageId", "id",
]);

function cell(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  // Text that a spreadsheet would run as a formula (aliases and names are typed by players) is
  // prefixed with an apostrophe so it opens as text. Numbers are left alone: -3 stays a number.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Own-property lookup in a label map, so an id can never resolve to an inherited member. */
function labelOf(map, id) {
  return typeof id === "string" && Object.hasOwn(map, id) && typeof map[id] === "string" ? map[id] : null;
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
      r.sessionKey, new Date(r.ts).toISOString(), labelOf(users, r.userId) ?? r.userId ?? "", labelOf(actors, r.actorId) ?? r.actorId ?? "", r.alias,
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
    ...r, userName: labelOf(users, r.userId), actorName: labelOf(actors, r.actorId), time: new Date(r.ts).toISOString(),
  }));
  return JSON.stringify(out, null, 1);
}
