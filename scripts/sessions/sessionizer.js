// @ts-check
// Session definitions (docs/PLAN.md M5). One pure assigner for three definitions:
//   daily  — one session per day in the world timezone with a boundary hour (v1.0 behaviour, stateless)
//   gap    — a session is a run of play: a new one starts after `gapHours` without a counted roll.
//            No clock boundary exists, so any timeslot and any date crossing works.
//   manual — GM Start/End; rolls outside a session go to the UNSCHEDULED bucket. A forgotten End
//            closes itself after `gapHours` of silence.
// Assignment is interval-based (not "previous roll"-based), so it is order-independent: live capture,
// catch-up and re-bucketing of stored history all give the same keys. No Foundry globals.

import { sessionKeyFor, localDateKey, compareKeys, UNSCHEDULED, DEFAULT_TIMEZONE, DEFAULT_BOUNDARY_HOUR } from "./bucket.js";

export { UNSCHEDULED };
export const MODES = Object.freeze(["daily", "gap", "manual"]);
export const DEFAULT_GAP_HOURS = 5;
const HOUR = 3_600_000;

/**
 * @typedef {object} SessionConfig
 * @property {"daily"|"gap"|"manual"} mode
 * @property {string} timezone
 * @property {number} boundaryHour
 * @property {number} gapHours
 * @property {{ key: string, startedTs: number } | null} [manualOpen]   the running manual session, if any
 *
 * @typedef {object} SessionInterval
 * @property {string} key
 * @property {number|null} firstTs
 * @property {number|null} lastTs
 * @property {{ startedTs: number, endedTs: number|null } | null} [manual]
 */

/** @param {Partial<SessionConfig>} [c] @returns {SessionConfig} */
export function normalizeConfig(c = {}) {
  const gap = Number(c.gapHours);
  const boundary = Number(c.boundaryHour);
  return {
    mode: MODES.includes(/** @type {any} */ (c.mode)) ? /** @type {any} */ (c.mode) : "daily",
    timezone: c.timezone || DEFAULT_TIMEZONE,
    boundaryHour: Number.isFinite(boundary) ? Math.min(23, Math.max(0, Math.trunc(boundary))) : DEFAULT_BOUNDARY_HOUR,
    gapHours: Number.isFinite(gap) && gap > 0 ? gap : DEFAULT_GAP_HOURS,
    manualOpen: c.manualOpen && c.manualOpen.key ? { key: c.manualOpen.key, startedTs: Number(c.manualOpen.startedTs) } : null,
  };
}

/** First of `base`, `base~2`, `base~3`, … that `taken.has()` does not know. */
export function nextFreeKey(base, taken) {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const k = `${base}~${i}`;
    if (!taken.has(k)) return k;
  }
}

export class Sessionizer {
  /**
   * @param {Partial<SessionConfig>} config
   * @param {SessionInterval[]} [sessions]   what already exists (keys, time spans, manual intervals)
   */
  constructor(config, sessions = []) {
    this.config = normalizeConfig(config);
    /** @type {Map<string, SessionInterval>} */
    this.sessions = new Map();
    for (const s of sessions) this.sessions.set(s.key, { key: s.key, firstTs: s.firstTs ?? null, lastTs: s.lastTs ?? null, manual: s.manual ?? null });
  }

  /** The key `ts` belongs to, WITHOUT recording it. */
  peek(ts) {
    const { mode } = this.config;
    if (mode === "gap") return this._gap(ts);
    if (mode === "manual") return this._manual(ts);
    return sessionKeyFor(ts, this.config);
  }

  /** The key `ts` belongs to; the session's time span grows to include it. */
  assign(ts) {
    const key = this.peek(ts);
    this.touch(key, ts);
    return key;
  }

  touch(key, ts) {
    const s = this.sessions.get(key);
    if (!s) { this.sessions.set(key, { key, firstTs: ts, lastTs: ts, manual: null }); return; }
    s.firstTs = s.firstTs === null ? ts : Math.min(s.firstTs, ts);
    s.lastTs = s.lastTs === null ? ts : Math.max(s.lastTs, ts);
  }

  _gap(ts) {
    const gap = this.config.gapHours * HOUR;
    let best = null, bestDist = Infinity;
    for (const s of this.sessions.values()) {
      if (s.key === UNSCHEDULED || s.firstTs === null || s.lastTs === null) continue;
      const dist = ts < s.firstTs ? s.firstTs - ts : ts > s.lastTs ? ts - s.lastTs : 0;
      if (dist <= gap && dist < bestDist) { best = s; bestDist = dist; }
    }
    if (best) return best.key;
    return nextFreeKey(localDateKey(ts, this.config.timezone), this.sessions);
  }

  _manual(ts) {
    for (const s of this.sessions.values()) {
      const m = s.manual;
      if (m && m.endedTs !== null && ts >= m.startedTs && ts <= m.endedTs) return s.key;
    }
    const open = this.config.manualOpen;
    if (open && ts >= open.startedTs && !this.manualExpired(ts)) return open.key;
    return UNSCHEDULED;
  }

  /** A running manual session with no roll for longer than the gap counts as ended (forgotten End). */
  manualExpired(now) {
    const open = this.config.manualOpen;
    if (!open) return false;
    const last = Math.max(open.startedTs, this.sessions.get(open.key)?.lastTs ?? 0);
    return now - last > this.config.gapHours * HOUR;
  }

  /**
   * The session that is "running" at `now`, or null: daily → today's key; gap → the newest session
   * if its last roll is within the gap; manual → the open session unless it has expired.
   */
  current(now) {
    const { mode } = this.config;
    if (mode === "daily") return sessionKeyFor(now, this.config);
    if (mode === "manual") return this.config.manualOpen && !this.manualExpired(now) ? this.config.manualOpen.key : null;
    let newest = null;
    for (const s of this.sessions.values()) {
      if (s.key === UNSCHEDULED || s.lastTs === null) continue;
      if (!newest || s.lastTs > newest.lastTs) newest = s;
    }
    return newest && now - newest.lastTs <= this.config.gapHours * HOUR && now >= newest.firstTs ? newest.key : null;
  }
}

/**
 * Re-apply a session definition to stored records (every record keeps its raw `ts`, decision D1).
 * Records of one message stay together. Manual intervals are authoritative in manual mode.
 * @param {Array<{ id: string, msgId: string, ts: number, sessionKey: string }>} records
 * @param {Partial<SessionConfig>} config
 * @param {{ manualSessions?: SessionInterval[] }} [opts]
 * @returns {Map<string, any[]>}  new key → records (copies with `sessionKey` updated), keys in chronological order
 */
export function rebucket(records, config, { manualSessions = [] } = {}) {
  const cfg = normalizeConfig(config);
  const seed = cfg.mode === "manual" ? manualSessions.filter((s) => s.manual).map((s) => ({ key: s.key, firstTs: null, lastTs: null, manual: s.manual })) : [];
  const sessionizer = new Sessionizer(cfg, seed);
  const sorted = [...records].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  const perMessage = new Map();
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const r of sorted) {
    let key = perMessage.get(r.msgId);
    if (!key) { key = sessionizer.assign(r.ts); perMessage.set(r.msgId, key); } else sessionizer.touch(key, r.ts);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ ...r, sessionKey: key });
  }
  return new Map([...out.entries()].sort((a, b) => compareKeys(a[0], b[0])));
}

/** Summary of what a re-bucket would change, for the confirm dialog. */
export function rebucketDiff(before, after) {
  const moved = [];
  const oldKeyOf = new Map();
  for (const [key, recs] of before) for (const r of recs) oldKeyOf.set(r.id, key);
  for (const [key, recs] of after) for (const r of recs) if (oldKeyOf.get(r.id) !== key) moved.push(r.id);
  const beforeKeys = [...before.keys()].filter((k) => (before.get(k) ?? []).length), afterKeys = [...after.keys()];
  return {
    moved: moved.length,
    created: afterKeys.filter((k) => !beforeKeys.includes(k)),
    removed: beforeKeys.filter((k) => !afterKeys.includes(k)),
    before: beforeKeys.map((k) => ({ key: k, n: before.get(k).length })),
    after: afterKeys.map((k) => ({ key: k, n: after.get(k).length })),
  };
}

/**
 * Sessions in the order they were played. Keys are identifiers, NOT a timeline: a session split off
 * or created later can carry a `~2` key yet have been played before its same-date sibling. Order by
 * first roll; sessions without rolls fall back to their manual Start, then to key order. The
 * unscheduled bucket always sorts first (so it ends up last in newest-first lists).
 * @template {{ key: string, firstTs?: number|null, manual?: { startedTs: number }|null }} T
 * @param {T[]} sessions
 * @returns {T[]}
 */
export function chronological(sessions) {
  const at = (s) => s.firstTs ?? s.manual?.startedTs ?? null;
  return [...sessions].sort((a, b) => {
    if (a.key === UNSCHEDULED || b.key === UNSCHEDULED) return a.key === b.key ? 0 : a.key === UNSCHEDULED ? -1 : 1;
    const ta = at(a), tb = at(b);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta === null && tb !== null) return compareKeys(a.key, b.key) || -1;
    if (tb === null && ta !== null) return compareKeys(a.key, b.key) || 1;
    return compareKeys(a.key, b.key);
  });
}

/** "We usually start at HH" → the boundary hour least likely to fall mid-game (12 hours opposite). */
export function boundaryForUsualStart(startHour) {
  return ((Math.trunc(Number(startHour)) % 24) + 24 + 12) % 24;
}

/**
 * Data for the preview sentence of the daily definition: a sample early-hours time and the day it
 * counts toward. Returns null when the boundary is midnight (sessions follow the calendar date).
 */
export function dailyExample(boundaryHour) {
  const b = Math.min(23, Math.max(0, Math.trunc(Number(boundaryHour))));
  if (b === 0) return null;
  const minutes = Math.round((b * 60) / 2 / 30) * 30; // half way between midnight and the boundary, on a half hour
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0"), mm = String(minutes % 60).padStart(2, "0");
  return { boundary: `${String(b).padStart(2, "0")}:00`, exampleTime: `${hh}:${mm}` };
}
