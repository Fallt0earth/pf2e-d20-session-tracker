// @ts-check
// Pure view-model: RollRecord[] → what the Tonight tab renders. Applies, in order, the viewer's access
// rules (GM sees everything; players per playerAccess/blindPolicy), the count mode (all physical dice
// or kept only), the raw/GM toggles, then groups by user or actor and computes luck per group.
// No Foundry globals: label maps and the viewer's identity come in through `opts` so it is unit-tested.

import { luckSummary, zBand } from "../stats/luck.js";
import { histogram } from "../stats/basic.js";

/**
 * @typedef {object} ViewOptions
 * @property {"all"|"kept"} [countMode]
 * @property {"user"|"actor"} [groupBy]
 * @property {boolean} [includeRaw]
 * @property {boolean} [includeGM]
 * @property {{ isGM: boolean, userId: string|null }} viewer
 * @property {"all"|"own"|"none"} [playerAccess]
 * @property {"hideCurrent"|"hideAlways"|"show"} [blindPolicy]
 * @property {string|null} [currentSessionKey]
 * @property {{ users?: Record<string,string>, actors?: Record<string,string>, gmUserIds?: string[] }} [labels]
 */

const DEFAULTS = { countMode: "all", groupBy: "user", includeRaw: true, includeGM: true, playerAccess: "all", blindPolicy: "hideCurrent", currentSessionKey: null, labels: {} };

/**
 * Records the viewer is allowed to see (before count-mode and grouping filters).
 * @param {import("../types.js").RollRecord[]} records
 * @param {ViewOptions} opts
 */
export function visibleRecords(records, opts) {
  const o = { ...DEFAULTS, ...opts };
  if (o.viewer?.isGM) return records;
  if (o.playerAccess === "none") return [];
  return records.filter((r) => {
    if (o.playerAccess === "own" && r.userId !== o.viewer?.userId) return false;
    const secret = r.blind || r.whispered;
    if (!secret) return true;
    if (o.blindPolicy === "show") return true;
    if (o.blindPolicy === "hideAlways") return false;
    return r.sessionKey !== o.currentSessionKey; // hideCurrent: past evenings are fine, tonight is not
  });
}

/**
 * Records that count toward the numbers (count mode, raw, GM toggles), after visibility.
 * @param {import("../types.js").RollRecord[]} records
 * @param {ViewOptions} opts
 */
export function countedRecords(records, opts) {
  const o = { ...DEFAULTS, ...opts };
  const gmIds = new Set(o.labels?.gmUserIds ?? []);
  return visibleRecords(records, o).filter((r) => {
    if (r.natural === null || r.natural === undefined) return false;
    if (o.countMode === "kept" && !r.kept) return false;
    if (!o.includeRaw && r.type === "raw") return false;
    if (!o.includeGM && r.userId && gmIds.has(r.userId)) return false;
    return true;
  });
}

/**
 * The Tonight model: party headline + one row per group, sorted hottest first.
 * @param {import("../types.js").RollRecord[]} records  Records of ONE session.
 * @param {ViewOptions} opts
 */
export function buildSessionModel(records, opts) {
  const o = { ...DEFAULTS, ...opts };
  const counted = countedRecords(records, o);
  const groups = new Map();
  for (const r of counted) {
    const key = (o.groupBy === "actor" ? r.actorId : r.userId) ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [...groups.entries()].map(([id, recs]) => groupRow(id, recs, o));
  rows.sort((a, b) => (b.luck.z ?? -Infinity) - (a.luck.z ?? -Infinity) || b.luck.n - a.luck.n || a.label.localeCompare(b.label));
  const party = groupRow("party", counted, o, "Party");
  return {
    total: records.length,
    visible: visibleRecords(records, o).length,
    counted: counted.length,
    party,
    rows,
    empty: counted.length === 0,
  };
}

function groupRow(id, recs, o, forcedLabel) {
  const naturals = recs.map((r) => r.natural);
  const luck = luckSummary(naturals);
  const byType = {};
  for (const r of recs) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const aliases = countValues(recs.map((r) => r.alias).filter(Boolean));
  const label = forcedLabel ?? labelFor(id, o, aliases);
  return {
    id, label,
    subtitle: o.groupBy === "user" && !forcedLabel ? topKeys(aliases, 2).join(", ") : "",
    luck, band: zBand(luck.zGuard === "none" ? null : luck.z),
    hist: histogram(naturals),
    byType,
    kept: recs.filter((r) => r.kept).length,
    rerolls: recs.filter((r) => r.isReroll).length,
    secret: recs.filter((r) => r.blind || r.whispered).length,
  };
}

function labelFor(id, o, aliases) {
  const map = o.groupBy === "actor" ? o.labels?.actors : o.labels?.users;
  if (map && map[id]) return map[id];
  if (o.groupBy === "actor") return topKeys(aliases, 1)[0] ?? (id === "unknown" ? "Unknown" : id);
  return id === "unknown" ? "Unknown" : id;
}

function countValues(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function topKeys(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
